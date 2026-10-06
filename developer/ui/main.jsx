import React from "react";
import { createRoot } from "react-dom/client";
import Editor from "./Editor.jsx";
import "./styles.css";
import { initializeTheme } from "../../src/theme.js";
initializeTheme();
createRoot(document.getElementById("root")).render(<Editor />);
