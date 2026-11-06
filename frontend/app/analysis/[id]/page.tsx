import { CvWorkspace } from "../../cv-workspace";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CvWorkspace key={id} analysisId={id} />;
}
