import * as data from "../src/modules/bestiary/data";
import * as details from "../src/modules/bestiary/detail-data";
import * as provenance from "../src/modules/bestiary/provenance";
import "../src/modules/bestiary/monster-info-page";
(globalThis as any).__bestiary = { ...data, ...details, ...provenance };
