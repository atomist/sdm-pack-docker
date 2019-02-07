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
    ProjectAwareGoalInvocation,
    projectConfigurationValue,
    SdmGoalEvent,
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
    return doWithProject(async gi => {
        const { goalEvent, context, project } = gi;

        const imageName = await imageNameCreator(project, goalEvent, options, context);
        const images = imageName.tags.map(tag => `${imageName.registry ? `${imageName.registry}/` : ""}${imageName.name}:${tag}`);
        const dockerfilePath = await (options.dockerfileFinder ? options.dockerfileFinder(project) : "Dockerfile");

        // 1. run docker login
        let result: ExecuteGoalResult = await dockerLogin(options, gi);

        if (result.code !== 0) {
            return result;
        }

        // 2. run docker build
        const tags = _.flatten(images.map(i => ["-t", i]));
        result = await gi.spawn(
            "docker",
            ["build", ".", "-f", dockerfilePath, ...tags],
        );

        if (result.code !== 0) {
            return result;
        }

        // 3. run docker push
        result = await dockerPush(images, options, gi);

        if (result.code !== 0) {
            return result;
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
    }, {
        readOnly: false,
        detachHead: true,
    });
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

    } else {
        gi.progressLog.write("Skipping 'docker login' because user and password are not configured");
        return Success;
    }
}

async function dockerPush(images: string[],
                          options: DockerOptions,
                          gi: ProjectAwareGoalInvocation): Promise<ExecuteGoalResult> {

    let push;
    // tslint:disable-next-line:no-boolean-literal-compare
    if (options.push === true || options.push === false) {
        push = options.push;
    } else {
        push = !isInLocalMode();
    }

    let result = Success;

    if ((await projectConfigurationValue("docker.push.enabled", gi.project, push))) {

        if (!options.user || !options.password) {
            const message = "Required configuration missing for pushing docker image. Please make sure to set " +
                "'registry', 'user' and 'password' in your configuration.";
            gi.progressLog.write(message);
            return { code: 1, message };
        }

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
