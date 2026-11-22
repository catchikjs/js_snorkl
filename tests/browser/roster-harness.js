import React from "react";
import { createRoot } from "react-dom/client";
import { StudentRoster } from "../../src/StudentRoster";
import "../../src/style.css";

createRoot(document.getElementById("app")).render(
  React.createElement(StudentRoster, {
    classroom: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "1학년 1반",
    },
  }),
);
