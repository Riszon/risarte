import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PresentationView } from "./presentation-view";
import { loadPresentationData } from "./presentation-data";

export const metadata: Metadata = { title: "Apresentação do plano" };

export default async function PresentationPage(
  props: PageProps<"/apresentacao/[clientId]">
) {
  const { clientId } = await props.params;
  const loaded = await loadPresentationData(clientId);
  if (!loaded.ok) {
    if (loaded.reason === "not_found") notFound();
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PresentationView data={loaded.data} clientId={clientId} />
    </div>
  );
}
