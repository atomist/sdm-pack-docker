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

import { logger } from "@atomist/automation-client";
import {
    DelimitedWriteProgressLogDecorator,
    execPromise,
    ExecPromiseResult,
    GoalInvocation,
} from "@atomist/sdm";
// tslint:disable-next-line:deprecation
import { SpawnedDeployment } from "@atomist/sdm-core";
import { spawn } from "child_process";
import * as portfinder from "portfinder";

/**
 * Options for the DockerPerBranchDeployer
 */
export interface DockerPerBranchDeployerOptions {
    /**
     * Starting port to be scanned for free ports
     */
    lowerPort: number;
    /**
     * Pattern that indicates that the container has started up correctly
     */
    successPatterns: RegExp[];
    /**
     * Base URL for the docker container. Probably localhost or your Docker machine IP
     */
    baseUrl: string;
    /**
     * The exposed port in the Dockerfile to be mapped externally
     */
    sourcePort: number;
}

/**
 * Deployer that uses `docker run` in order to deploy images produces by the `DockerBuild` goal.
 */
export class DockerPerBranchDeployer {

    // Already allocated ports
    public readonly repoBranchToPort: { [repoAndBranch: string]: number } = {};

    // Keys are ports: values are containerIds
    private readonly portToContainer: { [port: number]: string } = {};

    constructor(private readonly options: DockerPerBranchDeployerOptions) {
    }

    // tslint:disable-next-line:deprecation
    public async deployProject(goalInvocation: GoalInvocation): Promise<SpawnedDeployment> {
        const branch = goalInvocation.goalEvent.branch;

        let port = this.repoBranchToPort[goalInvocation.id.repo + ":" + branch];
        if (!port) {
            port = await portfinder.getPortPromise({ /*host: this.options.baseUrl,*/ port: this.options.lowerPort });
            this.repoBranchToPort[goalInvocation.id.repo + ":" + branch] = port;
        }
        const existingContainer = this.portToContainer[port];
        if (!!existingContainer) {
            await stopAndRemoveContainer(existingContainer);
        } else {
            // Check we won't end with a crazy number of child processes
            const presentCount = Object.keys(this.portToContainer)
                .filter(n => typeof n === "number")
                .length;
            if (presentCount >= 5) {
                throw new Error(`Unable to deploy project at ${goalInvocation.id} as limit of 5 has been reached`);
            }
        }

        const name = `${goalInvocation.id.repo}_${branch}`;
        const childProcess = spawn("docker",
            [
                "run",
                `-p${port}:${this.options.sourcePort}`,
                `--name=${name}`,
                goalInvocation.goalEvent.push.after.image.imageName,
            ],
            {});
        if (!childProcess.pid) {
            throw new Error("Fatal error deploying using Docker");
        }
        const deployment = {
            childProcess,
            endpoint: `${this.options.baseUrl}:${port}`,
        };

        this.portToContainer[port] = name;

        const newLineDelimitedLog = new DelimitedWriteProgressLogDecorator(goalInvocation.progressLog, "\n");
        childProcess.stdout.on("data", what => newLineDelimitedLog.write(what.toString()));
        childProcess.stderr.on("data", what => newLineDelimitedLog.write(what.toString()));
        let stdout = "";
        let stderr = "";

        // tslint:disable-next-line:deprecation
        return new Promise<SpawnedDeployment>((resolve, reject) => {
            childProcess.stdout.addListener("data", what => {
                if (!!what) {
                    stdout += what.toString();
                }
                if (this.options.successPatterns.some(successPattern => successPattern.test(stdout))) {
                    resolve(deployment);
                }
            });
            childProcess.stderr.addListener("data", what => {
                if (!!what) {
                    stderr += what.toString();
                }
            });
            childProcess.addListener("exit", async () => {
                if (this.options.successPatterns.some(successPattern => successPattern.test(stdout))) {
                    resolve(deployment);
                } else {
                    logger.error("Docker deployment failure vvvvvvvvvvvvvvvvvvvvvv");
                    logger.error("stdout:\n%s\nstderr:\n%s\n^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^", stdout, stderr);
                    reject(new Error("Docker deployment failure"));
                }
            });
            childProcess.addListener("error", reject);
        });
    }
}

function stopAndRemoveContainer(existingContainer: string): Promise<ExecPromiseResult> {
    return execPromise("docker",
        [
            "rm",
            "-f",
            existingContainer,
        ]);
}
