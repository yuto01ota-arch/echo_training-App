export const menuConfig = [
    {
        category: "ABDOMEN",
        items: [
            { title: "腹部：長軸", folder: "abs_long", structures: ["下大静脈","総腸骨静脈", "腹部大動脈", "総腸骨動脈", "脾静脈", "膵臓", "腹腔動脈","上腸間膜動脈"], start: { x: 78.1, y: 50 }, end: { x: 79.2, y: 70 }, rotate: 180 },
            { title: "腹部：短軸", folder: "abs_short", structures: ["胃", "胆嚢","総胆管", "下大静脈"], start: { x: 80.8, y: 50.0 }, end: { x: 65.4, y: 50.0 }, rotate: 270 },
            { title: "腹部：右肋弓下", folder: "abs_subcostal", structures: [], start: { x: 78.5, y: 40.5 }, end: { x: 64.3, y: 50.3 }, rotate: 220 },
            { title: "腹部：右肋間", type: "tilt", axis: "x", folder: "abs_intercostal", structures: ["門脈", "右肝静脈"], anchor: { x: 65, y: 40 }, startAngle: 240, endAngle: 180, baseRotate: 0 },
            { title: "腹部：右側腹部", folder: "abs_right_flank", structures: ["右腎", "肝臓"], start: { x: 63.7, y: 60.0 }, end: { x: 63.7, y: 75.0 }, rotate: 90 },
            { title: "腹部：左側腹部", type: "tilt", axis: "x", folder: "abs_left_flank", structures: ["左腎", "脾臓"], anchor: { x: 80, y: 40 }, startAngle: 90, endAngle: 30, baseRotate: 270 }           
        ]
    },
    {
        category: "UPPER LIMB",
        items: [
            { title: "前腕：正中神経", folder: "median_nerve_200", structures: ["正中神経"], start: { x: 80.1, y: 40.8 }, end: { x: 80.0, y: 50.4 }, rotate: 0, lineRotate: 0 },
            { title: "前腕：尺骨神経", folder: "ulnar", structures: ["尺骨神経", "尺骨動脈"],  start: {x:80, y:10},end: {x:80, y:30}, rotate: 0, lineRotate: 0 },
            { title: "前腕：橈骨神経", folder: "radial", structures: ["橈骨神経", "橈骨動脈"], start: { x: 80.0, y: 30 }, end: { x: 80, y: 40 }, rotate: 0, lineRotate: 0 }
        ]
    },
    {
        category: "LOWER LIMB",
        items: [
            { title: "下肢(右)：鼠径", folder: "leg_upper", structures: ["総大腿動脈", "浅大腿動脈", "深大腿動脈", "総大腿静脈"], start: { x: 89.1, y: 11.2 }, end: { x: 86.2, y: 25.2 }, rotate: 10, lineRotate: 20 },
            { title: "下肢(右)：膝裏", folder: "leg_lower", structures: ["膝窩動脈"], start: { x: 80, y: 20 }, end: { x: 80, y: 40 }, rotate: 0, lineRotate: 0 }
        ]
    },
    {
        category: "SAIKORO",
        directory: "saikoro",
        items: [
            { title: "test", category: "SAIKORO", categoryDir: "saikoro", folder: "saikoro_test", dataPath: "./src/frontend/saikoro/test.js", structures: [], frameCount: 1140, start: { x: 40, y: 50 }, end: { x: 60, y: 50 }, rotate: 0, lineRotate: 0 }
        ]
    }
];
