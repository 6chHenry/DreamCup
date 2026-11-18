export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeRenderJobs } = await import("@/lib/render-runner");
    resumeRenderJobs();
  }
}
