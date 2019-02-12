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

import {InMemoryProject} from "@atomist/automation-client";
import * as assert from "assert";
import {buildKanikoOptions} from "../../lib/docker/executeDockerBuild";

describe("buildKanikoOptions", () => {
    describe("push disabled", () => {
        it("should run a build with --no-push", async () => {
            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {cache: {enabled: false}, docker: {build: {push: false}}},
                },
            };
            const p = InMemoryProject.of({path: ".atomist/config.json", content: "{}"});
            const options = { push: false, builderArgs: [] as any}; // DockerOptions
            const gi = { // ProjectAwareGoalInvocation
                project: p,
            };
            const imageName = {
                name: "fake/fakeimage",
                tags: [
                    "localhost:5000/fake/fakeimage:0.1.0-SNAPSHOT-master.20190207134057",
                    "localhost:5000/fake/fakeimage:latest",
                ],
            };

            const result = await buildKanikoOptions(imageName, gi as any, options as any);
            assert.deepStrictEqual(result.sort(), ["--snapshotMode=time", "--reproducible", "--no-push"].sort());
        });
    });
    describe("push enabled", () => {
        it("should run a build with default push args", async () => {
            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {cache: {enabled: false}, docker: {build: {push: false}, latest: true}},
                },
            };
            const p = InMemoryProject.of({path: ".atomist/config.json", content: "{}"});
            const options = { push: true, builderArgs: [] as any}; // DockerOptions
            const gi = { // ProjectAwareGoalInvocation
                project: p,
            };
            const imageName = {
                name: "fake/fakeimage",
                tags: [
                    "localhost:5000/fake/fakeimage:0.1.0-SNAPSHOT-master.20190207134057",
                    "localhost:5000/fake/fakeimage:latest",
                ],
            };

            const expected = [
                "--snapshotMode=time",
                "--reproducible",
                ...imageName.tags.map(i => `-d=${i}`),
                "--cache=true",
            ];

            const result = await buildKanikoOptions(imageName, gi as any, options as any);
            assert.deepStrictEqual(result.sort(), expected.sort());
        });
    });
    describe("builder args", () => {
        it("should pass through custom builder args", async () => {
            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {cache: {enabled: false}, docker: {build: {push: false}, latest: true}},
                },
            };
            const p = InMemoryProject.of({path: ".atomist/config.json", content: "{}"});
            const options = { // DockerOptions
                push: true,
                builderArgs: ["--snapshotMode=full", "--cleanup"] as any,
            };
            const gi = { // ProjectAwareGoalInvocation
                project: p,
            };
            const imageName = {
                name: "fake/fakeimage",
                tags: [
                    "localhost:5000/fake/fakeimage:0.1.0-SNAPSHOT-master.20190207134057",
                    "localhost:5000/fake/fakeimage:latest",
                ],
            };

            const expected = [
                "--snapshotMode=full",
                ...imageName.tags.map(i => `-d=${i}`),
                "--cache=true",
                "--cleanup",
            ];

            const result = await buildKanikoOptions(imageName, gi as any, options as any);
            assert.deepStrictEqual(result.sort(), expected.sort());
        });
    });
});
