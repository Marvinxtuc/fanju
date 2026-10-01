-- Safe structural reversal only when formal history is absent.
-- With retained policies or money, use a forward corrective migration instead.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "V11PolicySnapshot" WHERE status='FORMAL_RUNTIME')
 OR EXISTS (SELECT 1 FROM "V11RuntimePolicyBinding")
 OR EXISTS (SELECT 1 FROM "V11SupplyRevision" WHERE status='FORMAL_APPROVED')
 OR EXISTS (SELECT 1 FROM "V11BundleConsent" WHERE source LIKE 'FORMAL_USER_DELIVERY:%')
 OR EXISTS (SELECT 1 FROM "V11Request" WHERE source LIKE 'FORMAL_%')
 OR EXISTS (SELECT 1 FROM "V11Decision" WHERE kind='FORMAL_REFUND_DECISION') THEN
 RAISE EXCEPTION 'Retained formal history exists: structural rollback refused';
 END IF;
END $$;
DROP TRIGGER "v11_formal_audit_history_guard" ON "AuditLog";
DROP FUNCTION v11_formal_audit_history_guard();
DROP TRIGGER "v11_formal_supply_delete_guard" ON "V11SupplyRevision";
DROP TRIGGER "v11_formal_consent_delete_guard" ON "V11BundleConsent";
DROP TRIGGER "v11_formal_request_history_guard" ON "V11Request";
DROP TRIGGER "v11_formal_decision_history_guard" ON "V11Decision";
DROP FUNCTION v11_formal_delete_guard();
DROP FUNCTION v11_formal_request_history_guard();
DROP FUNCTION v11_formal_decision_history_guard();
DROP TRIGGER "v11_formal_supply_immutable" ON "V11SupplyRevision";
DROP TRIGGER "v11_formal_supply_provenance_required" ON "V11SupplyRevision";
DROP TRIGGER "v11_formal_consent_immutable" ON "V11BundleConsent";
DROP TRIGGER "v11_formal_consent_provenance_required" ON "V11BundleConsent";
DROP FUNCTION v11_formal_supply_immutable();
DROP FUNCTION v11_formal_supply_provenance_required();
DROP FUNCTION v11_formal_consent_immutable();
DROP FUNCTION v11_formal_consent_provenance_required();
DROP TRIGGER "v11_runtime_policy_binding_immutable" ON "V11RuntimePolicyBinding";
DROP TRIGGER "v11_runtime_policy_snapshot_guard" ON "V11PolicySnapshot";
DROP TRIGGER "v11_runtime_policy_binding_required" ON "V11PolicySnapshot";
DROP FUNCTION v11_runtime_policy_binding_immutable();
DROP FUNCTION v11_runtime_policy_snapshot_guard();
DROP FUNCTION v11_runtime_policy_binding_required();
DROP TABLE "V11RuntimePolicyBinding";
ALTER TABLE "V11PolicySnapshot" DROP CONSTRAINT "V11PolicySnapshot_no_activation";
ALTER TABLE "V11PolicySnapshot" ADD CONSTRAINT "V11PolicySnapshot_no_activation" CHECK (status='LOCAL_DRAFT');
COMMIT;
