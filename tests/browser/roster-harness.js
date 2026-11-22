import React from "react";
import { createRoot } from "react-dom/client";
import { StudentRoster } from "../../src/StudentRoster";
import "../../src/style.css";
import "../../src/roster.css";
import "../../src/notice-toast.css";

const classes = Array.from({ length: 7 }, (_, i) => ({
  id: "20000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
  name: `1학년 ${i + 1}반`,
  school: "가상학교",
  year: 2026,
  number_prefix: `10${i + 1}`,
}));
createRoot(document.getElementById("app")).render(
  React.createElement(StudentRoster, { classroom: classes[0], classes }),
);
