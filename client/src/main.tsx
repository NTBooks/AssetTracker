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

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "create", element: <CreateItem /> },
      { path: "register", element: <RegisterAsset /> },
      { path: "verify", element: <Verify /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
