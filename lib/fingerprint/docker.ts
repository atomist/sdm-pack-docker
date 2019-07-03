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
    astUtils,
    logger,
    Project,
    ProjectFile,
    projectUtils,
} from "@atomist/automation-client";
import {
    ApplyFingerprint,
    ExtractFingerprint,
    Feature,
    FP,
    sha256,
} from "@atomist/sdm-pack-fingerprints";
import { DockerFileParser } from "../parse/DockerFileParser";

export const DockerPortsType = "docker-ports";

/**
 * Construct a Docker base image fingerprint from the given image and version
 * @param {string} image
 * @param {string} version
 * @return {FP}
 */
export function createDockerBaseFingerprint(image: string, version: string, path: string): FP {
    const data = { image, version, path };
    return {
        type: DockerFrom.name,
        name: image,
        abbreviation: `dbi-${image}`,
        version: "0.0.1",
        data,
        sha: sha256(JSON.stringify(data)),
    };
}

export async function parseDockerfile(p: Project, f: ProjectFile): Promise<FP> {
    const imageName: string[] = await astUtils.findValues(
        p, DockerFileParser, f.path, "//FROM/image/name");
    const imageVersion: string[] = await astUtils.findValues(
        p, DockerFileParser, f.path, "//FROM/image/tag");
    return createDockerBaseFingerprint(imageName[0], imageVersion[0] || "latest", f.path);
}

export const dockerBaseFingerprint: ExtractFingerprint = async p => {
    const fps: FP[] = [];
    for await (const f of projectUtils.fileIterator(p, "**/Dockerfile", async () => true)) {
        if (f && await f.getContent() !== "") {
            fps.push(await parseDockerfile(p, f));
        }
    }
    return fps;
};

export const applyDockerBaseFingerprint: ApplyFingerprint = async (p, fp) => {

    interface DockerFP {
        name: string;
        version: string;
        path: string;
    }

    const newFP = fp.data as DockerFP;

    try {
        await astUtils.doWithAllMatches(
            p,
            DockerFileParser,
            fp.data.path,
            "//FROM/image/tag",
            n => n.$value = newFP.version,
        );
        return (true);
    } catch (e) {
        logger.error(e);
        return false;
    }
};

export const DockerFrom: Feature = {
    displayName: "Docker base image",
    name: "docker-base-image",
    apply: applyDockerBaseFingerprint,
    extract: dockerBaseFingerprint,
    selector: myFp => myFp.type && myFp.type === DockerFrom.name,
    toDisplayableFingerprint: fp => fp.data.version,
};

function createDockerPortsFingerprint(data: string[]): FP {
    return {
        type: DockerPortsType,
        name: "docker-ports",
        abbreviation: `dps`,
        version: "0.0.1",
        data,
        sha: sha256(JSON.stringify(data)),
    };
}

export const extractDockerPortsFingerprint: ExtractFingerprint = async p => {
    const ports = await astUtils.findValues(p, DockerFileParser,
        "**/Dockerfile",
        "//EXPOSE/port");
    return ports.length > 0 ? createDockerPortsFingerprint(ports) : undefined;
};

export const DockerPorts: Feature = {
    displayName: "Docker base image",
    name: "docker-base-image",
    extract: extractDockerPortsFingerprint,
    selector: myFp => myFp.type && myFp.type === DockerPortsType,
    toDisplayableFingerprint: fp => fp.data.join(","),
};
