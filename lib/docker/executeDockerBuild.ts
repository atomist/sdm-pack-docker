/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    GitProject,
    HandlerContext,
    Success,
} from "@atomist/automation-client";
import {
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    LoggingProgressLog,
    ProjectAwareGoalInvocation,
    projectConfigurationValue,
    SdmGoalEvent,
    spawnLog,
} from "@atomist/sdm";
import {
    isInLocalMode,
    postLinkImageWebhook,
    readSdmVersion,
} from "@atomist/sdm-core";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as os from "os";
import * as path from "path";

/**
 * Options to configure the Docker image build
 */
export interface DockerOptions {

    /**
     * Provide the image tag for the docker image to build
     */
    dockerImageNameCreator?: DockerImageNameCreator;

    /**
     * True if the docker image should be pushed to the registry
     */
    push?: boolean;

    /**
     * Optional registry to push the docker image too.
     * Needs to set when push === true
     */
    registry?: string;

    /**
     * Optional user to use when pushing the docker image.
     * Needs to set when push === true
     */
    user?: string;

    /**
     * Optional password to use when pushing the docker image.
     * Needs to set when push === true
     */
    password?: string;

    /**
     * Optional Docker config in json as alternative to running
     * 'docker login' with provided registry, user and password.
     */
    config?: string;

    /**
     * Find the Dockerfile within the project
     * @param p the project
     */
    dockerfileFinder?: (p: GitProject) => Promise<string>;

    /**
     * Optionally specify what docker image builder to use.
     * Defaults to "docker"
     */
    builder?: "docker" | "kaniko";

    /**
     * Optional arguments passed to the docker image builder
     */
    builderArgs?: string[];
}

export type DockerImageNameCreator = (p: GitProject,
                                      sdmGoal: SdmGoalEvent,
                                      options: DockerOptions,
                                      ctx: HandlerContext) => Promise<{ registry: string, name: string, tags: string[] }>;

/**
 * Execute a Docker build for the project
 * @param {DockerImageNameCreator} imageNameCreator
 * @param {DockerOptions} options
 * @returns {ExecuteGoal}
 */
export function executeDockerBuild(options: DockerOptions): ExecuteGoal {
    return doWithProject(async gi => {
            const { goalEvent, context, project } = gi;

            switch (options.builder) {
                case "docker":
                    await checkIsBuilderAvailable("docker", "help");
                    break;
                case "kaniko":
                    await checkIsBuilderAvailable("/kaniko/executor", "--help");
                    break;
            }

            const imageName = await options.dockerImageNameCreator(project, goalEvent, options, context);
            const images = imageName.tags.map(tag => `${imageName.registry ? `${imageName.registry}/` : ""}${imageName.name}:${tag}`);
            const dockerfilePath = await (options.dockerfileFinder ? options.dockerfileFinder(project) : "Dockerfile");

            // 1. run docker login
            let result: ExecuteGoalResult = await dockerLogin(options, gi);

            if (result.code !== 0) {
                return result;
            }

            if (options.builder === "docker") {

                // 2. run docker build
                const tags = _.flatten(images.map(i => ["-t", i]));

                result = await gi.spawn(
                    "docker",
                    ["build", ".", "-f", dockerfilePath, ...tags, ...options.builderArgs],
                );

                if (result.code !== 0) {
                    return result;
                }

                // 3. run docker push
                result = await dockerPush(images, options, gi);

                if (result.code !== 0) {
                    return result;
                }

            } else if (options.builder === "kaniko") {

                // 2. run kaniko build
                const builderArgs: string[] = [];

                if (await pushEnabled(gi, options)) {
                    builderArgs.push(...images.map(i => `-d=${i}`), "--cache=true");
                } else {
                    builderArgs.push("--no-push");
                }
                builderArgs.push(
                    ...(options.builderArgs.length > 0 ? options.builderArgs : ["--snapshotMode=time", "--reproducible"]));

                // Check if base image cache dir is available
                const cacheFilPath = _.get(gi, "configuration.sdm.cache.path", "/opt/data");
                if (_.get(gi, "configuration.sdm.cache.enabled") === true && (await fs.pathExists(cacheFilPath))) {
                    const baseImageCache = path.join(cacheFilPath, "base-image-cache");
                    await fs.mkdirs(baseImageCache);
                    builderArgs.push(`--cache-dir=${baseImageCache}`, "--cache=true");
                }

                result = await gi.spawn(
                    "/kaniko/executor",
                    ["--dockerfile", dockerfilePath, "--context", `dir://${project.baseDir}`, ..._.uniq(builderArgs)],
                    {
                        env: {
                            ...process.env,
                            DOCKER_CONFIG: dockerConfigPath(options),
                        },
                        log: gi.progressLog,
                    },
                );

                if (result.code !== 0) {
                    return result;
                }
            }

            // 4. create image link
            if (await postLinkImageWebhook(
                goalEvent.repo.owner,
                goalEvent.repo.name,
                goalEvent.sha,
                images[0],
                context.workspaceId)) {
                return result;
            } else {
                return { code: 1, message: "Image link failed" };
            }
        },
        {
            readOnly: true,
            detachHead: false,
        },
    );
}

async function dockerLogin(options: DockerOptions,
                           gi: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> {

    if (options.user && options.password) {
        gi.progressLog.write("Running 'docker login'");
        const loginArgs: string[] = ["login", "--username", options.user, "--password", options.password];
        if (/[^A-Za-z0-9]/.test(options.registry)) {
            loginArgs.push(options.registry);
        }

        // 2. run docker login
        return gi.spawn(
            "docker",
            loginArgs,
            {
                logCommand: false,
                log: gi.progressLog,
            });

    } else if (options.config) {
        gi.progressLog.write("Authenticating with provided Docker config.json");
        await fs.writeFile(dockerConfigPath(options), options.config);
    } else {
        gi.progressLog.write("Skipping 'docker auth' because no credentials configured");
    }
    return Success;
}

async function dockerPush(images: string[],
                          options: DockerOptions,
                          gi: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> {

    let result = Success;

    if (await pushEnabled(gi, options)) {

        // 1. run docker push
        for (const image of images) {
            result = await gi.spawn(
                "docker",
                ["push", image],
            );

            if (result && result.code !== 0) {
                return result;
            }
        }
    } else {
        gi.progressLog.write("Skipping 'docker push'");
    }

    return result;
}

export const DefaultDockerImageNameCreator: DockerImageNameCreator = async (p, sdmGoal, options, context) => {
    const name = p.name;
    const tags = [await readSdmVersion(sdmGoal.repo.owner, sdmGoal.repo.name,
        sdmGoal.repo.providerId, sdmGoal.sha, sdmGoal.branch, context)];

    const latestTag = await projectConfigurationValue<boolean>("docker.tag.latest", p, false);
    if (latestTag && sdmGoal.branch === sdmGoal.push.repo.defaultBranch) {
        tags.push("latest");
    }

    return {
        registry: options.registry,
        name,
        tags,
    };
};

async function checkIsBuilderAvailable(cmd: string, ...args: string[]): Promise<void> {
    const result = await spawnLog(cmd, args, { log: new LoggingProgressLog("docker-build") });
    if (result.code !== 0) {
        throw new Error(`Configured Docker image builder '${cmd}' is not available`);
    }
}

async function pushEnabled(gi: ProjectAwareGoalInvocation, options: DockerOptions): Promise<boolean> {
    let push;
    // tslint:disable-next-line:no-boolean-literal-compare
    if (options.push === true || options.push === false) {
        push = options.push;
    } else if ((!!options.user && !!options.password) || !!options.config) {
        push = true;
    }
    return projectConfigurationValue("docker.build.push", gi.project, push);
}

function dockerConfigPath(options: DockerOptions): string {
    if (!!options.user && !!options.password) {
        return path.join(os.homedir(), ".docker", `config.json`);
    } else if (!!options.config) {
        return path.join(os.homedir(), ".docker", `config.sdm.json`);
    }
}
