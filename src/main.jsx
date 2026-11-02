import React from "react";
import { createRoot } from "react-dom/client";
import Admin from "./Admin";
import Kiosk from "./Kiosk";
import "./styles.css";
createRoot(document.getElementById("root")).render(
  location.pathname.startsWith("/admin") ? <Admin /> : <Kiosk />,
);
