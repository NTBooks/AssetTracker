import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import Layout from "./pages/Layout";
import Home from "./pages/Home";
import CreateItem from "./pages/CreateItem";
import RegisterAsset from "./pages/RegisterAsset";
import Verify from "./pages/Verify";
import { AuthProvider } from "./lib/auth";
import { ConfigProvider } from "./lib/config";
import Proof from "./pages/Proof";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "create", element: <CreateItem /> },
      { path: "register", element: <RegisterAsset /> },
      { path: "verify", element: <Verify /> },
      { path: "proof", element: <Proof /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ConfigProvider>
  </React.StrictMode>
);
