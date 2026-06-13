import { upperLimbData } from "./upperLimbData.js";
import { lowerLimbData } from "./lowerLimbData.js";
import { abdomenData } from "./abdomenData.js";
import { saikoroData } from "./saikoroData.js";

export const allData = {
    ...saikoroData,
    ...abdomenData,
    ...upperLimbData,
    ...lowerLimbData
};
