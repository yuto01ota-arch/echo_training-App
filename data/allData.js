import { upperLimbData } from "./upperLimbData.js";
import { lowerLimbData } from "./lowerLimbData.js";
import { abdomenData } from "./abdomenData.js";

export const allData = {
    ...abdomenData,
    ...upperLimbData,
    ...lowerLimbData
};
