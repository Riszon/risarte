"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { formatCnpj, formatCep, formatCpf, formatPhone } from "@/lib/masks";
import {
  COMPANY_CATEGORIES,
  COMPANY_CATEGORY_LABELS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  SUGGESTED_DOC_BY_CATEGORY,
  maskDocument,
  type CompanyCategory,
  type DocType,
} from "@/lib/empresarial/documents";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMPANY_STATUSES,
  COMPANY_STATUS_LABELS,
  PAYMENT_MODELS,
  PAYMENT_MODEL_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/empresarial/constants";
import type { Company } from "@/lib/empresarial/types";
import { createCompany, updateCompany } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function CompanyFormDialog({
  company,
  consultants,
}: {
  company?: Company;
  consultants: { id: string; label: string }[];
}) {
  const router = useRouter();
  const isEdit = Boolean(company);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Documento principal (a empresa pode ter vários — aba Documentos).
  const [category, setCategory] = useState<CompanyCategory>(
    company?.category ?? "empresa_privada"
  );
  const [docType, setDocType] = useState<DocType>("CNPJ");
  const [cnpj, setCnpj] = useState(company ? formatCnpj(company.cnpj) : "");

  // Trocar a categoria sugere o documento típico (o usuário pode mudar).
  function changeCategory(next: string) {
    const cat = next as CompanyCategory;
    setCategory(cat);
    if (!isEdit) {
      const suggested = SUGGESTED_DOC_BY_CATEGORY[cat];
      setDocType(suggested);
      setCnpj((cur) => maskDocument(suggested, cur));
    }
  }

  function changeDocType(next: string) {
    const t = next as DocType;
    setDocType(t);
    setCnpj((cur) => maskDocument(t, cur));
  }
  const [paymentModel, setPaymentModel] = useState<string>(
    company?.paymentModel ?? "EMPLOYEE_PAYS"
  );
  const showSubsidy = paymentModel === "COMPANY_PARTIAL";
  const addr = company?.address ?? {};

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = isEdit
        ? await updateCompany(company!.id, formData)
        : await createCompany(formData);
      if (result.ok) {
        toast.success(isEdit ? "Empresa atualizada." : "Empresa cadastrada.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              Editar
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="mr-1 size-4" />
              Nova empresa
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar ${company!.tradeName ?? company!.legalName}` : "Nova empresa"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Dados da empresa
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="category">Categoria *</Label>
              <select
                id="category"
                name="category"
                value={category}
                onChange={(e) => changeCategory(e.target.value)}
                className={selectClass}
              >
                {COMPANY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {COMPANY_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-2">
              <div>
                <Label htmlFor="doc_type">Documento *</Label>
                <select
                  id="doc_type"
                  name="doc_type"
                  value={docType}
                  onChange={(e) => changeDocType(e.target.value)}
                  className={selectClass}
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="cnpj">Número *</Label>
                <Input
                  id="cnpj"
                  name="cnpj"
                  required
                  value={cnpj}
                  onChange={(e) => setCnpj(maskDocument(docType, e.target.value))}
                />
              </div>
            </div>
            {docType === "CAEPF" && (
              <div>
                <Label htmlFor="holder_cpf">CPF do titular (CAEPF) *</Label>
                <Input
                  id="holder_cpf"
                  name="holder_cpf"
                  required
                  placeholder="000.000.000-00"
                  onChange={(e) => (e.target.value = formatCpf(e.target.value))}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <p className="rounded-md border border-gold/40 bg-gold/5 px-2.5 py-1.5 text-xs">
                Este é o documento <strong>principal</strong>
                {DOC_TYPE_LABELS[docType] !== docType
                  ? ` (${DOC_TYPE_LABELS[docType]})`
                  : ""}
                . Filiais e outros CNPJs entram na aba{" "}
                <strong>Documentos</strong> da empresa.
              </p>
            </div>
            <div>
              <Label htmlFor="state_registration">Inscrição estadual</Label>
              <Input
                id="state_registration"
                name="state_registration"
                defaultValue={company?.stateRegistration ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="legal_name">Razão social *</Label>
              <Input
                id="legal_name"
                name="legal_name"
                required
                defaultValue={company?.legalName ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="trade_name">Nome fantasia</Label>
              <Input
                id="trade_name"
                name="trade_name"
                defaultValue={company?.tradeName ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="employee_count">Nº de colaboradores (estimado)</Label>
              <Input
                id="employee_count"
                name="employee_count"
                type="number"
                min={0}
                defaultValue={company?.employeeCount ?? ""}
              />
            </div>
            {isEdit && (
              <div>
                <Label htmlFor="status">Situação</Label>
                <select
                  id="status"
                  name="status"
                  defaultValue={company?.status ?? "ACTIVE"}
                  className={selectClass}
                >
                  {COMPANY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {COMPANY_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Responsável pela empresa (quem assina e trata com o Risarte)
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="responsible_name">Nome</Label>
              <Input
                id="responsible_name"
                name="responsible_name"
                defaultValue={company?.responsibleName ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="responsible_role">Cargo</Label>
              <Input
                id="responsible_role"
                name="responsible_role"
                placeholder="Ex.: Gerente de RH"
                defaultValue={company?.responsibleRole ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="responsible_cpf">CPF</Label>
              <Input
                id="responsible_cpf"
                name="responsible_cpf"
                placeholder="000.000.000-00"
                defaultValue={company?.responsibleCpf ?? ""}
                onChange={(e) => (e.target.value = formatCpf(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="responsible_phone">Telefone</Label>
              <Input
                id="responsible_phone"
                name="responsible_phone"
                placeholder="(00) 00000-0000"
                defaultValue={company?.responsiblePhone ?? ""}
                onChange={(e) => (e.target.value = formatPhone(e.target.value))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="responsible_email">E-mail</Label>
              <Input
                id="responsible_email"
                name="responsible_email"
                type="email"
                defaultValue={company?.responsibleEmail ?? ""}
              />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Endereço
          </p>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label htmlFor="zip_code">CEP</Label>
              <Input
                id="zip_code"
                name="zip_code"
                placeholder="00000-000"
                defaultValue={addr.zipCode ?? ""}
                onChange={(e) => {
                  e.target.value = formatCep(e.target.value);
                }}
              />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="street">Logradouro</Label>
              <Input id="street" name="street" defaultValue={addr.street ?? ""} />
            </div>
            <div>
              <Label htmlFor="number">Número</Label>
              <Input id="number" name="number" defaultValue={addr.number ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="complement">Complemento</Label>
              <Input
                id="complement"
                name="complement"
                defaultValue={addr.complement ?? ""}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="neighborhood">Bairro</Label>
              <Input
                id="neighborhood"
                name="neighborhood"
                defaultValue={addr.neighborhood ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" name="city" defaultValue={addr.city ?? ""} />
            </div>
            <div>
              <Label htmlFor="state">UF</Label>
              <Input
                id="state"
                name="state"
                maxLength={2}
                defaultValue={addr.state ?? ""}
              />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Programa e pagamento
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="payment_model">Modelo de pagamento *</Label>
              <select
                id="payment_model"
                name="payment_model"
                required
                value={paymentModel}
                onChange={(e) => setPaymentModel(e.target.value)}
                className={selectClass}
              >
                {PAYMENT_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_MODEL_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            {showSubsidy && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="company_subsidy_type">Subsídio</Label>
                  <select
                    id="company_subsidy_type"
                    name="company_subsidy_type"
                    defaultValue={company?.companySubsidyType ?? "PERCENT"}
                    className={selectClass}
                  >
                    <option value="PERCENT">Percentual (%)</option>
                    <option value="AMOUNT">Valor (R$)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="company_subsidy_value">Quanto</Label>
                  <Input
                    id="company_subsidy_value"
                    name="company_subsidy_value"
                    defaultValue={
                      company?.companySubsidyValue != null
                        ? company.companySubsidyType === "AMOUNT"
                          ? (company.companySubsidyValue / 100).toString()
                          : company.companySubsidyValue.toString()
                        : ""
                    }
                  />
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="due_day">Dia de vencimento (1–28)</Label>
              <Input
                id="due_day"
                name="due_day"
                type="number"
                min={1}
                max={28}
                defaultValue={company?.dueDay ?? 5}
              />
            </div>
            <div>
              <Label htmlFor="default_max_installments">
                Parcelamento máximo (x)
              </Label>
              <Input
                id="default_max_installments"
                name="default_max_installments"
                type="number"
                min={1}
                max={24}
                defaultValue={company?.defaultMaxInstallments ?? 24}
              />
            </div>
            <div>
              <Label htmlFor="contract_started_at">Início do contrato</Label>
              <Input
                id="contract_started_at"
                name="contract_started_at"
                type="date"
                defaultValue={company?.contractStartedAt ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="assigned_consultant_id">Consultor RisLife</Label>
              <select
                id="assigned_consultant_id"
                name="assigned_consultant_id"
                defaultValue={company?.assignedConsultantId ?? ""}
                className={selectClass}
              >
                <option value="">— sem consultor —</option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="grace_period_days">Carência da empresa (dias)</Label>
              <Input
                id="grace_period_days"
                name="grace_period_days"
                type="number"
                min={0}
                defaultValue={company?.gracePeriodDays ?? 0}
              />
            </div>
            <div>
              <Label htmlFor="employee_grace_period_days">
                Carência do colaborador (dias)
              </Label>
              <Input
                id="employee_grace_period_days"
                name="employee_grace_period_days"
                type="number"
                min={0}
                defaultValue={company?.employeeGracePeriodDays ?? 0}
              />
            </div>
          </div>
          <div>
            <Label>Meios de pagamento aceitos</Label>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {PAYMENT_METHODS.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="payment_methods"
                    value={m}
                    defaultChecked={
                      company
                        ? company.paymentMethods.includes(m)
                        : m !== "CARD"
                    }
                  />
                  {PAYMENT_METHOD_LABELS[m]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Observações</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={company?.notes ?? ""}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Salvar" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
