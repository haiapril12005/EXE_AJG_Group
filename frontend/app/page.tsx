import { redirect } from "next/navigation";

/**
 * The job list is the home page. The analysis form lives at /analyze; an older link that
 * carried a job to analyze (/?job=...) still reaches that form with the job filled in.
 */
export default async function Home({ searchParams }: {
  searchParams: Promise<{ job?: string | string[] }>;
}) {
  const { job } = await searchParams;
  redirect(typeof job === "string" && job ? `/analyze?job=${encodeURIComponent(job)}` : "/jobs");
}
