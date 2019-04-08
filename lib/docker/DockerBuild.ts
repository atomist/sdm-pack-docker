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
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    getGoalDefinitionFrom,
    Goal,
    GoalDefinition,
    ImplementationRegistration,
    IndependentOfEnvironment,
    mergeOptions,
} from "@atomist/sdm";
import { DockerProgressReporter } from "./DockerProgressReporter";
import {
    DefaultDockerImageNameCreator,
    DockerImageNameCreator,
    DockerOptions,
    executeDockerBuild,
} from "./executeDockerBuild";

/**
 * Registration for a certain docker build and push configuration
 */
export interface DockerBuildRegistration extends Partial<ImplementationRegistration> {

    /**
     * Options to configure the docker build
     */
    options?: DockerOptions;

    /**
     * @deprecated use options.dockerImageNameCreator
     */
    imageNameCreator?: DockerImageNameCreator;
}

const DefaultDockerOptions: DockerOptions = {
    dockerImageNameCreator: DefaultDockerImageNameCreator,
    dockerfileFinder: async () => "Dockerfile",
    push: false,
    builder: "docker",
    builderArgs: [],
    builderPath: ".",
};

/**
 * Goal that performs docker build and push depending on the provided options
 */
export class DockerBuild extends FulfillableGoalWithRegistrations<DockerBuildRegistration> {

    constructor(private readonly goalDetailsOrUniqueName: FulfillableGoalDetails | string = DefaultGoalNameGenerator.generateName("docker-build"),
                ...dependsOn: Goal[]) {

        super(getGoalDefinitionFrom(
            goalDetailsOrUniqueName,
            DefaultGoalNameGenerator.generateName("docker-build"),
            DockerBuildDefinition)
            , ...dependsOn);
    }

    public with(registration: DockerBuildRegistration): this {
        const optsToUse = mergeOptions<DockerOptions>(DefaultDockerOptions, registration.options);

        // Backwards compatibility
        // tslint:disable:deprecation
        if (!!registration.imageNameCreator && (!registration.options || !registration.options.dockerImageNameCreator)) {
            optsToUse.dockerImageNameCreator = registration.imageNameCreator;
        }
        // tslint:enable:deprecation

        this.addFulfillment({
            goalExecutor: executeDockerBuild(optsToUse),
            name: DefaultGoalNameGenerator.generateName("docker-builder"),
            progressReporter: DockerProgressReporter,
            ...registration as ImplementationRegistration,
        });
        return this;
    }
}

const DockerBuildDefinition: GoalDefinition = {
    uniqueName: "docker-build",
    displayName: "docker build",
    environment: IndependentOfEnvironment,
    workingDescription: "Running docker build",
    completedDescription: "Docker build successful",
    failedDescription: "Docker build failed",
    isolated: true,
    retryFeasible: true,
};
