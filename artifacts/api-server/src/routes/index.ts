import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import stockRouter from "./stock";
import fundamentalsRouter from "./fundamentals";
import outcomeRouter from "./outcome";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(stockRouter);
router.use(fundamentalsRouter);
router.use(outcomeRouter);

export default router;
