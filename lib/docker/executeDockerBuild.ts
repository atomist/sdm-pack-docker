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
    spawnAndWatch,
    Success,
    SuccessIsReturn0ErrorFinder,
} from "@atomist/automation-client";
import {
    ExecuteGoal,
    ExecuteGoalResult,
    GoalInvocation,
    ProgressLog,
    projectConfigurationValue,
    SdmGoalEvent,
} from "@atomist/sdm";
import {
    isInLocalMode,
    postLinkImageWebhook,
    readSdmVersion,
} from "@atomist/sdm-core";

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
                                      ctx: HandlerContext) => Promise<{ registry: string, name: string, version: string }>;

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

            const spOpts = {
                errorFinder: SuccessIsReturn0ErrorFinder,
            };

            const imageName = await imageNameCreator(p, sdmGoal, options, context);
            const image = `${imageName.registry ? `${imageName.registry}/` : ""}${imageName.name}:${imageName.version}`;
            const dockerfilePath = await (options.dockerfileFinder ? options.dockerfileFinder(p) : "Dockerfile");

            // 1. run docker login
            let result: ExecuteGoalResult = await dockerLogin(options, progressLog);

            if (result.code !== 0) {
                return result;
            }

            // 2. run docker build
            result = await spawnAndWatch(
                {
                    command: "docker",
                    args: ["build", ".", "-f", dockerfilePath, "-t", image],
                },
                opts,
                progressLog,
                spOpts);

            if (result.code !== 0) {
                return result;
            }

            // 3. run docker push
            result = await dockerPush(image, p, options, progressLog);

            if (result.code !== 0) {
                return result;
            }

            // 4. create image link
            if (await postLinkImageWebhook(
                sdmGoal.repo.owner,
                sdmGoal.repo.name,
                sdmGoal.sha,
                image,
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

    const spOpts = {
        errorFinder: SuccessIsReturn0ErrorFinder,
    };

    if (options.user && options.password) {
        progressLog.write("Running 'docker login'");
        const loginArgs: string[] = ["login", "--username", options.user, "--password", options.password];
        if (/[^A-Za-z0-9]/.test(options.registry)) {
            loginArgs.push(options.registry);
        }

        // 2. run docker login
        return spawnAndWatch(
            {
                command: "docker",
                args: loginArgs,
            },
            {},
            progressLog,
            {
                ...spOpts,
                logCommand: false,
            });

    } else {
        progressLog.write("Skipping 'docker login' because user and password are not configured");
        return Success;
    }
}

async function dockerPush(image: string,
                          project: GitProject,
                          options: DockerOptions,
                          progressLog: ProgressLog): Promise<ExecuteGoalResult> {

    const spOpts = {
        errorFinder: SuccessIsReturn0ErrorFinder,
    };

    // Default so that we don't attempt to push in local mode
    if (options.push === undefined) {
        options.push = !isInLocalMode();
    }

    if (projectConfigurationValue("docker.push.enabled", project, options.push || true)) {

        if (!options.user || !options.password) {
            const message = "Required configuration missing for pushing docker image. Please make sure to set " +
                "'registry', 'user' and 'password' in your configuration.";
            progressLog.write(message);
            return { code: 1, message };
        }

        // 1. run docker push
        return spawnAndWatch(
            {
                command: "docker",
                args: ["push", image],
            },
            {},
            progressLog,
            spOpts);

    } else {
        progressLog.write("Skipping 'docker push'");
    }

    return Success;
}

export const DefaultDockerImageNameCreator: DockerImageNameCreator = async (p, sdmGoal, options, context) => {
    const name = p.name;
    const version = await readSdmVersion(sdmGoal.repo.owner, sdmGoal.repo.name,
        sdmGoal.repo.providerId, sdmGoal.sha, sdmGoal.branch, context);
    return {
        registry: options.registry,
        name,
        version,
    };
};
