import { defineApp } from "convex/server";
import betterAuth from "@aussieljk/convex-better-auth/convex.config";
import resend from "@convex-dev/resend/convex.config";

const app = defineApp();
app.use(betterAuth);
app.use(resend);

export default app;
