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
    DefaultGoalNameGenerator,
    ExecuteGoal,
    ExecuteGoalResult,
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    getGoalDefinitionFrom,
    Goal,
    GoalInvocation,
    ImplementationRegistration,
    IndependentOfEnvironment,
} from "@atomist/sdm";
import {
    DockerPerBranchDeployer,
    DockerPerBranchDeployerOptions,
} from "./DockerPerBranchDeployer";

/**
 * Options for Docker deployment goal
 */
export interface DockerDeployRegistration extends Partial<ImplementationRegistration> {
    /**
     * Starting port to be scanned for free ports. Defaults to 9090
     */
    lowerPort?: number;
    /**
     * Pattern that indicates that the container has started up correctly
     */
    successPatterns: RegExp[];
    /**
     * Base URL for the docker container. Probably localhost or your Docker machine IP. Defaults to localhost
     */
    baseUrl?: string;
    /**
     * The exposed port in the Dockerfile to be mapped externally
     */
    sourcePort: number;
}

/**
 * Goal definition for deployment using Docker
 */
export const DockerDeployGoal = new Goal({
    uniqueName: "docker-deploy",
    displayName: "docker deploy",
    environment: IndependentOfEnvironment,
    workingDescription: "Deploying using Docker",
    completedDescription: "Deployed with Docker",
    failedDescription: "Docker deployment failed",
});

/**
 * This goal will deploy the Docker image built by the `DockerBuild` goal. Deployments mapped
 * to free ports and a deployment will be done per branch.
 */
export class DockerDeploy extends FulfillableGoalWithRegistrations<DockerDeployRegistration> {
    constructor(private readonly goalDetailsOrUniqueName: FulfillableGoalDetails | string = DefaultGoalNameGenerator.generateName("docker-deploy"),
                ...dependsOn: Goal[]) {
        super({
            ...DockerDeployGoal.definition,
            ...getGoalDefinitionFrom(goalDetailsOrUniqueName, DefaultGoalNameGenerator.generateName("docker-deploy")),
            displayName: "version",
        }, ...dependsOn);
    }

    public with(registration: DockerDeployRegistration): this {
        this.addFulfillment({
            goalExecutor: executeDockerRun( {
                successPatterns: registration.successPatterns,
                lowerPort: registration.lowerPort ? registration.lowerPort : 9090,
                baseUrl: registration.baseUrl ? registration.baseUrl : "http://127.0.0.1",
                sourcePort: registration.sourcePort,
            }),
            name: DefaultGoalNameGenerator.generateName("docker-runner"),
            ...registration as ImplementationRegistration,
        });
        return this;
    }
}

function executeDockerRun(options: DockerPerBranchDeployerOptions): ExecuteGoal {
    const deployer = new DockerPerBranchDeployer(options);
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        return deployer.deployProject(goalInvocation).then(deployment => {
                return {
                    code: 0,
                    targetUrl: deployment.endpoint,
                };
            },
        ).catch(reason => {
            return {
                code: 1,
                message: reason,
            };
        });
    };
}
