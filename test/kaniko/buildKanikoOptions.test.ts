import {InMemoryProject} from "@atomist/automation-client";
import {buildKanikoOptions} from "../../lib/docker/executeDockerBuild";
import * as assert from "assert";

describe("buildKanikoOptions", () => {
    describe("push disabled", () => {
        it("should run a build with --no-push", async () => {
            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {cache: {enabled: false}, docker: {build: {push: false}}}
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
})
