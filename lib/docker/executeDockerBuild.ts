/*
 * Copyright © 2018 Atomist, Inc.
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
    ExecuteGoal,
    ExecuteGoalResult,
    GoalInvocation,
    ProgressLog,
    projectConfigurationValue,
    SdmGoalEvent,
    spawnAndLog,
} from "@atomist/sdm";
import {
    isInLocalMode,
    postLinkImageWebhook,
    readSdmVersion,
} from "@atomist/sdm-core";
import * as _ from "lodash";

export interface DockerOptions {

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

    dockerfileFinder?: (p: GitProject) => Promise<string>;
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
export function executeDockerBuild(imageNameCreator: DockerImageNameCreator,
                                   options: DockerOptions): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<void | ExecuteGoalResult> => {
        const { configuration, sdmGoal, credentials, id, context, progressLog } = goalInvocation;

        return configuration.sdm.projectLoader.doWithProject({
                credentials,
                id,
                context,
                readOnly: false,
                cloneOptions: { detachHead: true },
            },
            async p => {

                const opts = {
                    cwd: p.baseDir,
                };

                const imageName = await imageNameCreator(p, sdmGoal, options, context);
                const images = imageName.tags.map(tag => `${imageName.registry ? `${imageName.registry}/` : ""}${imageName.name}:${tag}`);
                const dockerfilePath = await (options.dockerfileFinder ? options.dockerfileFinder(p) : "Dockerfile");

                // 1. run docker login
                let result: ExecuteGoalResult = await dockerLogin(options, progressLog);

                if (result.code !== 0) {
                    return result;
                }

                // 2. run docker build
                const tags = _.flatten(images.map(i => ["-t", i]));
                result = await spawnAndLog(
                    progressLog,
                    "docker",
                    ["build", ".", "-f", dockerfilePath, ...tags],
                    opts,
                );

                if (result.code !== 0) {
                    return result;
                }

                // 3. run docker push
                result = await dockerPush(images, p, options, progressLog);

                if (result.code !== 0) {
                    return result;
                }

                // 4. create image link
                if (await postLinkImageWebhook(
                    sdmGoal.repo.owner,
                    sdmGoal.repo.name,
                    sdmGoal.sha,
                    images[0],
                    context.workspaceId)) {
                    return result;
                } else {
                    return { code: 1, message: "Image link failed" };
                }
            });
    };
}

async function dockerLogin(options: DockerOptions,
                           progressLog: ProgressLog): Promise<ExecuteGoalResult> {

    if (options.user && options.password) {
        progressLog.write("Running 'docker login'");
        const loginArgs: string[] = ["login", "--username", options.user, "--password", options.password];
        if (/[^A-Za-z0-9]/.test(options.registry)) {
            loginArgs.push(options.registry);
        }

        // 2. run docker login
        return spawnAndLog(
            progressLog,
            "docker",
            loginArgs,
            {
                logCommand: false,
            });

    } else {
        progressLog.write("Skipping 'docker login' because user and password are not configured");
        return Success;
    }
}

async function dockerPush(images: string[],
                          project: GitProject,
                          options: DockerOptions,
                          progressLog: ProgressLog): Promise<ExecuteGoalResult> {

    let push;
    // tslint:disable-next-line:no-boolean-literal-compare
    if (options.push === true || options.push === false) {
        push = options.push;
    } else {
        push = !isInLocalMode();
    }

    let result = Success;

    if ((await projectConfigurationValue("docker.push.enabled", project, push))) {

        if (!options.user || !options.password) {
            const message = "Required configuration missing for pushing docker image. Please make sure to set " +
                "'registry', 'user' and 'password' in your configuration.";
            progressLog.write(message);
            return { code: 1, message };
        }

        // 1. run docker push
        for (const image of images) {
            result = await spawnAndLog(
                progressLog,
                "docker",
                ["push", image],
            );

            if (result && result.code !== 0) {
                return result;
            }
        }
    } else {
        progressLog.write("Skipping 'docker push'");
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
