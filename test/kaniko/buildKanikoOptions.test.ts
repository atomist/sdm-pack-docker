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

import { InMemoryProject } from "@atomist/automation-client";
import * as assert from "assert";
import * as fsMock from "mock-fs";
import { buildKanikoOptions } from "../../lib/docker/executeDockerBuild";

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
                "--cleanup",
            ];

            const result = await buildKanikoOptions(imageName, gi as any, options as any);
            assert.deepStrictEqual(result.sort(), expected.sort());
        });
    });
    describe("cache options", () => {
        before(() => {
            fsMock({
                "/opt/data": {},
                "/opt/newthing": {},
            });
        });
        after(() => {
            fsMock.restore();
        });
        it("should enable cache and set default cache dir", async () => {
            const config = {
                sdm: {cache: {enabled: true}, docker: {build: {push: false}, latest: true}},
            };
            (global as any).__runningAutomationClient = {
                configuration: {
                    ...config,
                },
            };
            const p = InMemoryProject.of({path: ".atomist/config.json", content: "{}"});
            const options = { // DockerOptions
                push: true,
                builderArgs: [] as any,
            };
            const gi = { // ProjectAwareGoalInvocation
                project: p,
                configuration: {
                    ...config,
                },
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
                "--cache=true",
                "--cache-dir=/opt/data/base-image-cache",
                ...imageName.tags.map(i => `-d=${i}`),
            ];

            const result = await buildKanikoOptions(imageName, gi as any, options as any);
            assert.deepStrictEqual(result.sort(), expected.sort());
        });
        it("should enable cache and set custom cache dir", async () => {
            const config = {
                sdm: {cache: {enabled: true, path: "/opt/newthing"}, docker: {build: {push: false}, latest: true}},
            };
            (global as any).__runningAutomationClient = {
                configuration: {
                    ...config,
                },
            };
            const p = InMemoryProject.of({path: ".atomist/config.json", content: "{}"});
            const options = { // DockerOptions
                push: false,
                builderArgs: [] as any,
            };
            const gi = { // ProjectAwareGoalInvocation
                project: p,
                configuration: {
                    ...config,
                },
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
                "--no-push",
                "--cache=true",
                "--cache-dir=/opt/newthing/base-image-cache",
            ];

            const result = await buildKanikoOptions(imageName, gi as any, options as any);
            assert.deepStrictEqual(result.sort(), expected.sort());
        });
        it("should error for invalid cache path location", async () => {
            const config = {
                sdm: {cache: {enabled: true, path: "/opt/notathing"}, docker: {build: {push: false}, latest: true}},
            };
            (global as any).__runningAutomationClient = {
                configuration: {
                    ...config,
                },
            };
            const p = InMemoryProject.of({path: ".atomist/config.json", content: "{}"});
            const options = { // DockerOptions
                push: false,
                builderArgs: [] as any,
            };
            const gi = { // ProjectAwareGoalInvocation
                project: p,
                configuration: {
                    ...config,
                },
            };
            const imageName = {
                name: "fake/fakeimage",
                tags: [
                    "localhost:5000/fake/fakeimage:0.1.0-SNAPSHOT-master.20190207134057",
                    "localhost:5000/fake/fakeimage:latest",
                ],
            };

            try {
                await buildKanikoOptions(imageName, gi as any, options as any);
            } catch (e) {
                assert.strictEqual(e.message, "Cannot enable Kaniko cache, path /opt/notathing doesn't exist!");
            }
        });
    });
});
