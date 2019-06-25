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
    projectUtils,
} from "@atomist/automation-client";
import { File } from "@atomist/automation-client/lib/project/File";
import { Project } from "@atomist/automation-client/lib/project/Project";
import { ApplyFingerprint, ExtractFingerprint, Feature, FP, sha256 } from "@atomist/sdm-pack-fingerprints";
import { DockerFileParser } from "../parse/DockerFileParser";

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

export async function parseDockerfile(p: Project, f: File): Promise<FP> {

    const imageName: string[] = await astUtils.findValues(
        p, DockerFileParser, f.path, "//FROM/image/name");
    const imageVersion: string[] = await astUtils.findValues(
        p, DockerFileParser, f.path, "//FROM/image/tag");

    const fp: FP = createDockerBaseFingerprint(imageName[0], imageVersion[0] || "latest", f.path);

    return fp;
}

export const dockerBaseFingerprint: ExtractFingerprint = async p => {
    const files = await projectUtils.toPromise(p.streamFiles("**/Dockerfile"));

    const fps: FP[] = [];

    for (const f of files) {
        if (f && await f.getContent() !== "") {
            fps.push(await parseDockerfile(p, f));
        }
    }
    return fps;
};

export const applyDockerBaseFingerprint: ApplyFingerprint = async (p, fp) => {
    logger.info(`apply ${JSON.stringify(fp)} to ${p.id.url}`);

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
