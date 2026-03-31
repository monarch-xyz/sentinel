import express from "express";
import { buildSignalTemplateCatalogResponse } from "../catalog.ts";

const router: express.Router = express.Router();

router.get("/", (_req, res) => {
  res.json(buildSignalTemplateCatalogResponse());
});

export default router;
