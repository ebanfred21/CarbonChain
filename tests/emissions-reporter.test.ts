import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface EmissionsReport {
  hash: string; // buff as hex string
  timestamp: number;
  scope1: number;
  scope2: number;
  scope3: number;
  metadata: string;
  validated: boolean;
  amendmentCount: number;
}

interface ReportAmendment {
  newHash: string;
  newScope1: number;
  newScope2: number;
  newScope3: number;
  reason: string;
  timestamp: number;
  approved: boolean;
}

interface Validator {
  active: boolean;
  validationCount: number;
  stake: number;
}

interface ReductionClaim {
  claimedReduction: number;
  evidenceHash: string;
  verified: boolean;
}

interface ReportHistory {
  periods: string[];
}

interface ContractState {
  admin: string;
  paused: boolean;
  reportCounter: number;
  amendmentFee: number;
  emissionsReports: Map<string, EmissionsReport>; // Key: `${company}-${period}`
  reportAmendments: Map<string, ReportAmendment>; // Key: `${company}-${period}-${amendmentId}`
  validators: Map<string, Validator>;
  reductionClaims: Map<string, ReductionClaim>; // Key: `${company}-${period}`
  reportHistory: Map<string, ReportHistory>; // Key: company
}

// Mock contract implementation
class EmissionsReporterMock {
  private state: ContractState = {
    admin: "deployer",
    paused: false,
    reportCounter: 0,
    amendmentFee: 100,
    emissionsReports: new Map(),
    reportAmendments: new Map(),
    validators: new Map(),
    reductionClaims: new Map(),
    reportHistory: new Map(),
  };

  private MAX_METADATA_LEN = 1000;
  private MAX_SCOPE_VALUE = 999999999999999;
  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_PERIOD = 101;
  private ERR_INVALID_SCOPE = 102;
  private ERR_ALREADY_SUBMITTED = 103;
  private ERR_INVALID_HASH = 104;
  private ERR_PAUSED = 105;
  private ERR_INVALID_AMENDMENT = 106;
  private ERR_NOT_AMENDABLE = 107;
  private ERR_METADATA_TOO_LONG = 108;
  private ERR_INVALID_REDUCTION_CLAIM = 109;
  private ERR_INVALID_VALIDATOR = 110;

  private mockBlockHeight = 1000; // Simulated block height

  // Helper to simulate block height increase
  private incrementBlockHeight() {
    this.mockBlockHeight += 1;
  }

  private isValidPeriod(period: string): boolean {
    return period.length > 0 && period.startsWith("20");
  }

  private isValidScope(value: number): boolean {
    return value > 0 && value <= this.MAX_SCOPE_VALUE;
  }

  private isValidHash(hash: string): boolean {
    return hash.length === 64; // Hex string for buff 32
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  addValidator(caller: string, validator: string, initialStake: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.validators.has(validator)) {
      return { ok: false, value: this.ERR_ALREADY_SUBMITTED };
    }
    this.state.validators.set(validator, { active: true, validationCount: 0, stake: initialStake });
    return { ok: true, value: true };
  }

  removeValidator(caller: string, validator: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const val = this.state.validators.get(validator);
    if (val) {
      val.active = false;
      this.state.validators.set(validator, val);
    }
    return { ok: true, value: true };
  }

  submitReport(
    caller: string,
    period: string,
    hash: string,
    scope1: number,
    scope2: number,
    scope3: number,
    metadata: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const key = `${caller}-${period}`;
    if (this.state.emissionsReports.has(key)) {
      return { ok: false, value: this.ERR_ALREADY_SUBMITTED };
    }
    if (!this.isValidPeriod(period)) {
      return { ok: false, value: this.ERR_INVALID_PERIOD };
    }
    if (!this.isValidScope(scope1) || !this.isValidScope(scope2) || !this.isValidScope(scope3)) {
      return { ok: false, value: this.ERR_INVALID_SCOPE };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    if (!this.isValidHash(hash)) {
      return { ok: false, value: this.ERR_INVALID_HASH };
    }
    this.state.emissionsReports.set(key, {
      hash,
      timestamp: this.mockBlockHeight,
      scope1,
      scope2,
      scope3,
      metadata,
      validated: false,
      amendmentCount: 0,
    });
    const history = this.state.reportHistory.get(caller) || { periods: [] };
    history.periods.push(period);
    if (history.periods.length > 100) history.periods.shift();
    this.state.reportHistory.set(caller, history);
    const reportId = this.state.reportCounter + 1;
    this.state.reportCounter = reportId;
    this.incrementBlockHeight();
    return { ok: true, value: reportId };
  }

  amendReport(
    caller: string,
    period: string,
    newHash: string,
    newScope1: number,
    newScope2: number,
    newScope3: number,
    reason: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const reportKey = `${caller}-${period}`;
    const report = this.state.emissionsReports.get(reportKey);
    if (!report) {
      return { ok: false, value: this.ERR_INVALID_AMENDMENT };
    }
    if (report.amendmentCount > 5) {
      return { ok: false, value: this.ERR_NOT_AMENDABLE };
    }
    if (!this.isValidHash(newHash)) {
      return { ok: false, value: this.ERR_INVALID_HASH };
    }
    const amendmentId = report.amendmentCount + 1;
    const amendmentKey = `${caller}-${period}-${amendmentId}`;
    this.state.reportAmendments.set(amendmentKey, {
      newHash,
      newScope1,
      newScope2,
      newScope3,
      reason,
      timestamp: this.mockBlockHeight,
      approved: false,
    });
    report.amendmentCount = amendmentId;
    this.state.emissionsReports.set(reportKey, report);
    this.incrementBlockHeight();
    return { ok: true, value: amendmentId };
  }

  validateReport(caller: string, company: string, period: string): ClarityResponse<boolean> {
    const validator = this.state.validators.get(caller);
    if (!validator || !validator.active) {
      return { ok: false, value: this.ERR_INVALID_VALIDATOR };
    }
    const reportKey = `${company}-${period}`;
    const report = this.state.emissionsReports.get(reportKey);
    if (!report) {
      return { ok: false, value: this.ERR_INVALID_PERIOD };
    }
    if (report.validated) {
      return { ok: false, value: this.ERR_ALREADY_SUBMITTED };
    }
    report.validated = true;
    this.state.emissionsReports.set(reportKey, report);
    validator.validationCount += 1;
    this.state.validators.set(caller, validator);
    return { ok: true, value: true };
  }

  approveAmendment(caller: string, company: string, period: string, amendmentId: number): ClarityResponse<boolean> {
    const validator = this.state.validators.get(caller);
    if (!validator || !validator.active) {
      return { ok: false, value: this.ERR_INVALID_VALIDATOR };
    }
    const amendmentKey = `${company}-${period}-${amendmentId}`;
    const amendment = this.state.reportAmendments.get(amendmentKey);
    if (!amendment || amendment.approved) {
      return { ok: false, value: this.ERR_INVALID_AMENDMENT };
    }
    const reportKey = `${company}-${period}`;
    const report = this.state.emissionsReports.get(reportKey);
    if (!report) {
      return { ok: false, value: this.ERR_INVALID_AMENDMENT };
    }
    report.hash = amendment.newHash;
    report.scope1 = amendment.newScope1;
    report.scope2 = amendment.newScope2;
    report.scope3 = amendment.newScope3;
    report.timestamp = this.mockBlockHeight;
    this.state.emissionsReports.set(reportKey, report);
    amendment.approved = true;
    this.state.reportAmendments.set(amendmentKey, amendment);
    validator.validationCount += 1;
    this.state.validators.set(caller, validator);
    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  claimReduction(caller: string, period: string, reduction: number, evidenceHash: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (reduction > 100) {
      return { ok: false, value: this.ERR_INVALID_REDUCTION_CLAIM };
    }
    if (!this.isValidHash(evidenceHash)) {
      return { ok: false, value: this.ERR_INVALID_HASH };
    }
    const reportKey = `${caller}-${period}`;
    if (!this.state.emissionsReports.has(reportKey)) {
      return { ok: false, value: this.ERR_INVALID_PERIOD };
    }
    const claimKey = `${caller}-${period}`;
    this.state.reductionClaims.set(claimKey, {
      claimedReduction: reduction,
      evidenceHash,
      verified: false,
    });
    return { ok: true, value: true };
  }

  verifyReduction(caller: string, company: string, period: string): ClarityResponse<boolean> {
    const validator = this.state.validators.get(caller);
    if (!validator || !validator.active) {
      return { ok: false, value: this.ERR_INVALID_VALIDATOR };
    }
    const claimKey = `${company}-${period}`;
    const claim = this.state.reductionClaims.get(claimKey);
    if (!claim || claim.verified) {
      return { ok: false, value: this.ERR_INVALID_REDUCTION_CLAIM };
    }
    claim.verified = true;
    this.state.reductionClaims.set(claimKey, claim);
    validator.validationCount += 1;
    this.state.validators.set(caller, validator);
    return { ok: true, value: true };
  }

  getReport(company: string, period: string): ClarityResponse<EmissionsReport | null> {
    const key = `${company}-${period}`;
    return { ok: true, value: this.state.emissionsReports.get(key) ?? null };
  }

  getReportHistory(company: string): ClarityResponse<ReportHistory | null> {
    return { ok: true, value: this.state.reportHistory.get(company) ?? null };
  }

  getAmendment(company: string, period: string, amendmentId: number): ClarityResponse<ReportAmendment | null> {
    const key = `${company}-${period}-${amendmentId}`;
    return { ok: true, value: this.state.reportAmendments.get(key) ?? null };
  }

  getReductionClaim(company: string, period: string): ClarityResponse<ReductionClaim | null> {
    const key = `${company}-${period}`;
    return { ok: true, value: this.state.reductionClaims.get(key) ?? null };
  }

  isValidated(company: string, period: string): boolean {
    const key = `${company}-${period}`;
    const report = this.state.emissionsReports.get(key);
    return report ? report.validated : false;
  }

  getTotalEmissions(company: string, period: string): number {
    const key = `${company}-${period}`;
    const report = this.state.emissionsReports.get(key);
    return report ? report.scope1 + report.scope2 + report.scope3 : 0;
  }

  getValidatorInfo(validator: string): ClarityResponse<Validator | null> {
    return { ok: true, value: this.state.validators.get(validator) ?? null };
  }

  isContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAmendmentFee(): ClarityResponse<number> {
    return { ok: true, value: this.state.amendmentFee };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  company1: "company_1",
  company2: "company_2",
  validator1: "validator_1",
  unauthorized: "unauthorized",
};

describe("EmissionsReporter Contract", () => {
  let contract: EmissionsReporterMock;

  beforeEach(() => {
    contract = new EmissionsReporterMock();
    vi.resetAllMocks();
  });

  it("should allow admin to add validator", () => {
    const addValidator = contract.addValidator(accounts.deployer, accounts.validator1, 1000);
    expect(addValidator).toEqual({ ok: true, value: true });

    const validatorInfo = contract.getValidatorInfo(accounts.validator1);
    expect(validatorInfo).toEqual({
      ok: true,
      value: { active: true, validationCount: 0, stake: 1000 },
    });
  });

  it("should prevent non-admin from adding validator", () => {
    const addValidator = contract.addValidator(accounts.unauthorized, accounts.validator1, 1000);
    expect(addValidator).toEqual({ ok: false, value: 100 });
  });

  it("should allow company to submit report", () => {
    const hash = "a".repeat(64); // Valid hex hash
    const submitResult = contract.submitReport(
      accounts.company1,
      "2025-Q1",
      hash,
      100,
      200,
      300,
      "Test metadata"
    );
    expect(submitResult).toEqual({ ok: true, value: 1 });

    const report = contract.getReport(accounts.company1, "2025-Q1");
    expect(report).toEqual({
      ok: true,
      value: expect.objectContaining({
        hash,
        scope1: 100,
        scope2: 200,
        scope3: 300,
        validated: false,
      }),
    });

    const totalEmissions = contract.getTotalEmissions(accounts.company1, "2025-Q1");
    expect(totalEmissions).toBe(600);

    const history = contract.getReportHistory(accounts.company1);
    expect(history).toEqual({ ok: true, value: { periods: ["2025-Q1"] } });
  });

  it("should prevent submission with invalid period", () => {
    const hash = "a".repeat(64);
    const submitResult = contract.submitReport(
      accounts.company1,
      "invalid",
      hash,
      100,
      200,
      300,
      "Test"
    );
    expect(submitResult).toEqual({ ok: false, value: 101 });
  });

  it("should prevent submission when paused", () => {
    contract.pauseContract(accounts.deployer);
    const hash = "a".repeat(64);
    const submitResult = contract.submitReport(
      accounts.company1,
      "2025-Q1",
      hash,
      100,
      200,
      300,
      "Test"
    );
    expect(submitResult).toEqual({ ok: false, value: 105 });
  });

  it("should allow amendment of report", () => {
    const hash = "a".repeat(64);
    contract.submitReport(accounts.company1, "2025-Q1", hash, 100, 200, 300, "Test");

    const newHash = "b".repeat(64);
    const amendResult = contract.amendReport(
      accounts.company1,
      "2025-Q1",
      newHash,
      150,
      250,
      350,
      "Correction reason"
    );
    expect(amendResult).toEqual({ ok: true, value: 1 });

    const amendment = contract.getAmendment(accounts.company1, "2025-Q1", 1);
    expect(amendment).toEqual({
      ok: true,
      value: expect.objectContaining({
        newHash,
        newScope1: 150,
        approved: false,
      }),
    });
  });

  it("should allow validator to validate report", () => {
    contract.addValidator(accounts.deployer, accounts.validator1, 1000);
    const hash = "a".repeat(64);
    contract.submitReport(accounts.company1, "2025-Q1", hash, 100, 200, 300, "Test");

    const validateResult = contract.validateReport(accounts.validator1, accounts.company1, "2025-Q1");
    expect(validateResult).toEqual({ ok: true, value: true });

    const isValidated = contract.isValidated(accounts.company1, "2025-Q1");
    expect(isValidated).toBe(true);

    const validatorInfo = contract.getValidatorInfo(accounts.validator1);
    expect(validatorInfo.value?.validationCount).toBe(1);
  });

  it("should allow validator to approve amendment", () => {
    contract.addValidator(accounts.deployer, accounts.validator1, 1000);
    const hash = "a".repeat(64);
    contract.submitReport(accounts.company1, "2025-Q1", hash, 100, 200, 300, "Test");
    const newHash = "b".repeat(64);
    contract.amendReport(accounts.company1, "2025-Q1", newHash, 150, 250, 350, "Reason");

    const approveResult = contract.approveAmendment(accounts.validator1, accounts.company1, "2025-Q1", 1);
    expect(approveResult).toEqual({ ok: true, value: true });

    const report = contract.getReport(accounts.company1, "2025-Q1");
    expect(report.value?.scope1).toBe(150);
    expect(report.value?.hash).toBe(newHash);

    const amendment = contract.getAmendment(accounts.company1, "2025-Q1", 1);
    expect(amendment.value?.approved).toBe(true);
  });

  it("should allow company to claim reduction", () => {
    const hash = "a".repeat(64);
    contract.submitReport(accounts.company1, "2025-Q1", hash, 100, 200, 300, "Test");
    const evidenceHash = "c".repeat(64);
    const claimResult = contract.claimReduction(accounts.company1, "2025-Q1", 20, evidenceHash);
    expect(claimResult).toEqual({ ok: true, value: true });

    const claim = contract.getReductionClaim(accounts.company1, "2025-Q1");
    expect(claim).toEqual({
      ok: true,
      value: { claimedReduction: 20, evidenceHash, verified: false },
    });
  });

  it("should allow validator to verify reduction", () => {
    contract.addValidator(accounts.deployer, accounts.validator1, 1000);
    const hash = "a".repeat(64);
    contract.submitReport(accounts.company1, "2025-Q1", hash, 100, 200, 300, "Test");
    const evidenceHash = "c".repeat(64);
    contract.claimReduction(accounts.company1, "2025-Q1", 20, evidenceHash);

    const verifyResult = contract.verifyReduction(accounts.validator1, accounts.company1, "2025-Q1");
    expect(verifyResult).toEqual({ ok: true, value: true });

    const claim = contract.getReductionClaim(accounts.company1, "2025-Q1");
    expect(claim.value?.verified).toBe(true);
  });

  it("should prevent metadata exceeding max length in submit", () => {
    const hash = "a".repeat(64);
    const longMetadata = "a".repeat(1001);
    const submitResult = contract.submitReport(
      accounts.company1,
      "2025-Q1",
      hash,
      100,
      200,
      300,
      longMetadata
    );
    expect(submitResult).toEqual({ ok: false, value: 108 });
  });
});