import { CvWorkspace } from "../../cv-workspace";

export default async function CvPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ evaluation?: string | string[] }>;
}) {
  const { id } = await params;
  const { evaluation } = await searchParams;
  return <CvWorkspace key={id} cvId={id} evaluationId={typeof evaluation === "string" ? evaluation : undefined} />;
}
