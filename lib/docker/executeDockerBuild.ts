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
    mergeOptions,
    ProjectAwareGoalInvocation,
    projectConfigurationValue,
    SdmGoalEvent,
    spawnLog,
} from "@atomist/sdm";
import {
    postLinkImageWebhook,
    readSdmVersion,
} from "@atomist/sdm-core";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as os from "os";
import * as path from "path";
import { cleanImageName } from "./name";

export interface DockerRegistry {
    /**
     * Push Url for this registry
     */
    url: string;

    /**
     * Display Url - ie the url humans can go to
     * assumes <url>/<image>
     */
    displayUrl?: string;

    /**
     * If specified, this will replace the label version details (eg <image><:version>)
     * For example, for Dockerhub the correct value would be `/tags`, with a displayUrl set
     * to https://hub.docker.com/r/<user/org>; will result in:
     * https://hub.docker.com/r/<user/org>/<image>/tags as the link URL
     *
     */
    displayBrowsePath?: string;

    /**
     * How should urls to this registry be labeled?
     * ie DockerHub, ECR, etc (friendly name instead of big tag string)
     * if not supplied, we'll display the tag
     */
    label?: string;
    username?: string;
    password?: string;
}
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
     * Optional Docker config in json as alternative to running
     * 'docker login' with provided registry, user and password.
     */
    config?: string;

    /**
     * Optional registries to push the docker image too.
     * Needs to set when push === true
     */
    registries?: DockerRegistry[];

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
                                      ctx: HandlerContext) => Promise<{ name: string, tags: string[] }>;

/**
 * Execute a Docker build for the project
 * @param {DockerOptions} options
 * @returns {ExecuteGoal}
 */
export function executeDockerBuild(options: DockerOptions): ExecuteGoal {
    return doWithProject(async gi => {
        const { goalEvent, context, project } = gi;

        const optsToUse = mergeOptions<DockerOptions>(options, {}, "docker.build");

        switch (optsToUse.builder) {
            case "docker":
                await checkIsBuilderAvailable("docker", "help");
                break;
            case "kaniko":
                await checkIsBuilderAvailable("/kaniko/executor", "--help");
                break;
        }

        const imageName = await optsToUse.dockerImageNameCreator(project, goalEvent, optsToUse, context);
        const dockerfilePath = await (optsToUse.dockerfileFinder ? optsToUse.dockerfileFinder(project) : "Dockerfile");
        const externalUrls = getExternalUrls(imageName.tags, optsToUse);

        let result: ExecuteGoalResult;
        if (optsToUse.builder === "docker") {

            const tags = _.flatten(imageName.tags.map(i => ["-t", i]));

            result = await gi.spawn(
                "docker",
                ["build", "-f", dockerfilePath, ...tags, ...optsToUse.builderArgs, "."],
                {
                    env: {
                        ...process.env,
                        // TODO: Cleanup the intent here
                        DOCKER_CONFIG: dockerConfigPath(optsToUse.registries[0], optsToUse.config, gi.goalEvent),
                    },
                    log: gi.progressLog,
                },
            );

            if (result.code !== 0) {
                return result;
            }

            result = await dockerPush(imageName.tags, optsToUse, gi);
            if (result.code !== 0) {
                return result;
            }

        } else if (optsToUse.builder === "kaniko") {

            // 2. run kaniko build
            const builderArgs: string[] = [];

            if (await pushEnabled(gi, optsToUse)) {
                builderArgs.push(
                    ...imageName.tags.map(i => `-d=${i}`),
                    "--cache=true",
                    `--cache-repo=${imageName.tags[0]}-cache`);
            } else {
                builderArgs.push("--no-push");
            }
            builderArgs.push(
                ...(optsToUse.builderArgs.length > 0 ? optsToUse.builderArgs : ["--snapshotMode=time", "--reproducible"]));

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
                        // TODO: Cleanup the intent here
                        DOCKER_CONFIG: dockerConfigPath(optsToUse.registries[0], optsToUse.config, gi.goalEvent),
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
            imageName.tags[0],
            context.workspaceId)) {
            return {
                code: 0,
                externalUrls,
            };
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

async function dockerLogin(options: DockerRegistry,
                           config: string | undefined,
                           gi: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> {

    if (options.username && options.password) {
        gi.progressLog.write("Running 'docker login'");
        const loginArgs: string[] = ["login", "--username", options.username, "--password", options.password];
        if (/[^A-Za-z0-9]/.test(options.url)) {
            loginArgs.push(options.url);
        }

        // 2. run docker login
        return gi.spawn(
            "docker",
            loginArgs,
            {
                logCommand: false,
                log: gi.progressLog,
            });

    } else if (config) {
        gi.progressLog.write("Authenticating with provided Docker 'config.json'");
        const dockerConfig = path.join(dockerConfigPath(options, config, gi.goalEvent), "config.json");
        await fs.ensureDir(path.dirname(dockerConfig));
        await fs.writeFile(dockerConfig, config);
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

        // Login to registry(s)
        await Promise.all(
            options.registries.map(async r => {
                const loginResult = await dockerLogin(r, options.config, gi);
                if (loginResult.code !== 0) {
                    return loginResult;
                }
            }),
        );

        // 1. run docker push
        await Promise.all(
            images.map(async image => {
                result = await gi.spawn(
                    "docker",
                    ["push", image],
                    {
                        env: {
                            ...process.env,
                            // TODO: Determine intent and update
                            DOCKER_CONFIG: dockerConfigPath(options.registries[0], options.config, gi.goalEvent),
                        },
                        log: gi.progressLog,
                    },
                );

                if (result && result.code !== 0) {
                    return result;
                }
            }),
        );
    } else {
        gi.progressLog.write("Skipping 'docker push'");
    }

    return result;
}

export const DefaultDockerImageNameCreator: DockerImageNameCreator = async (p, sdmGoal, options, context) => {
    const name = cleanImageName(p.name);
    const version =
        await readSdmVersion(sdmGoal.repo.owner, sdmGoal.repo.name, sdmGoal.repo.providerId, sdmGoal.sha, sdmGoal.branch, context);

    // If there are configured registries, set tags for each; otherwise return just version
    const tags: string[] = [];
    const latestTag = await projectConfigurationValue<boolean>("docker.tag.latest", p, false);
    options.registries.map(r => {
        tags.push(`${r.url}/${name}:${version}`);
        if (latestTag && sdmGoal.branch === sdmGoal.push.repo.defaultBranch) {
            tags.push(`${r.url}/${name}:latest`);
        }
    });

    return {
        name,
        tags,
    };
};

async function checkIsBuilderAvailable(cmd: string, ...args: string[]): Promise<void> {
    try {
        await spawnLog(cmd, args, { log: new LoggingProgressLog("docker-build-check") });
    } catch (e) {
        throw new Error(`Configured Docker image builder '${cmd}' is not available`);
    }
}

async function pushEnabled(gi: ProjectAwareGoalInvocation, options: DockerOptions): Promise<boolean> {
    let push;
    // tslint:disable-next-line:no-boolean-literal-compare
    if (options.push === true || options.push === false) {
        push = options.push;
    }
    // TODO: What does this do?
    // else if ((!!options.user && !!options.password) || !!options.config) {
    //     push = true;
    // }
    return projectConfigurationValue("docker.build.push", gi.project, push);
}

function dockerConfigPath(options: DockerRegistry, config: string | undefined, goalEvent: SdmGoalEvent): string {
    if (options && (!!options.username && !!options.password)) {
        return path.join(os.homedir(), ".docker");
    } else if (!!config) {
        return path.join(os.homedir(), `.docker-${goalEvent.goalSetId}`);
    }
}

function getExternalUrls(tags: string[], options: DockerOptions): ExecuteGoalResult["externalUrls"] {
    const externalUrls = tags.map(t => {
        const reg = options.registries.filter(r => t.includes(r.url))[0];
        let url = !!reg.displayUrl ? t.replace(reg.url, reg.displayUrl) : t;

        if (!!reg.displayBrowsePath) {
           const replace = url.split(":").pop();
           url = url.replace(`:${replace}`, `${reg.displayBrowsePath}`);
        }
        if (!!reg.label) {
            return {label: reg.label, url };
        } else {
            return {url};
        }
    });

    return _.uniqBy(externalUrls, "url");
}
