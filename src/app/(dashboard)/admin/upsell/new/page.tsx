import { UpsellRuleForm } from "@/components/admin/UpsellRuleForm";

export const dynamic = "force-dynamic";

export default function NewUpsellRulePage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nuova regola upsell</h1>
      <UpsellRuleForm mode="create" />
    </div>
  );
}
