import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OrderBook } from "./widget/order-book";
import "./widget/theme.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html must contain #root");
createRoot(root).render(
  <StrictMode>
    <OrderBook coin="BTC" />
  </StrictMode>,
);
