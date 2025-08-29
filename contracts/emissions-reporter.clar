;; EmissionsReporter.clar
;; Core contract for immutable corporate emissions tracking
;; Handles submission, validation, and querying of emissions reports
;; Integrates with future contracts like CompanyRegistry via principal checks

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-PERIOD u101)
(define-constant ERR-INVALID-SCOPE u102)
(define-constant ERR-ALREADY-SUBMITTED u103)
(define-constant ERR-INVALID-HASH u104)
(define-constant ERR-PAUSED u105)
(define-constant ERR-INVALID-AMENDMENT u106)
(define-constant ERR-NOT-AMENDABLE u107)
(define-constant ERR-METADATA-TOO-LONG u108)
(define-constant ERR-INVALID-REDUCTION-CLAIM u109)
(define-constant ERR-INVALID-VALIDATOR u110)
(define-constant MAX-METADATA-LEN u1000)
(define-constant MAX-SCOPE-VALUE u999999999999999) ;; Arbitrary large number for tCO2e

;; Data Variables
(define-data-var contract-admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var report-counter uint u0)
(define-data-var amendment-fee uint u100) ;; In microstacks, adjustable

;; Data Maps
(define-map emissions-reports
  { company: principal, period: (string-ascii 32) } ;; e.g., "2025-Q1"
  {
    hash: (buff 32), ;; SHA-256 of full report
    timestamp: uint,
    scope1: uint, ;; tCO2e
    scope2: uint,
    scope3: uint,
    metadata: (string-utf8 1000), ;; Additional notes/evidence links
    validated: bool,
    amendment-count: uint
  }
)

(define-map report-amendments
  { company: principal, period: (string-ascii 32), amendment-id: uint }
  {
    new-hash: (buff 32),
    new-scope1: uint,
    new-scope2: uint,
    new-scope3: uint,
    reason: (string-utf8 500),
    timestamp: uint,
    approved: bool
  }
)

(define-map validators
  { validator: principal }
  {
    active: bool,
    validation-count: uint,
    stake: uint ;; Staked amount for accountability
  }
)

(define-map reduction-claims
  { company: principal, period: (string-ascii 32) }
  {
    claimed-reduction: uint, ;; Percentage
    evidence-hash: (buff 32),
    verified: bool
  }
)

(define-map report-history
  { company: principal }
  { periods: (list 100 (string-ascii 32)) } ;; Up to 100 historical periods
)

;; Private Functions
(define-private (is-admin (caller principal))
  (is-eq caller (var-get contract-admin))
)

(define-private (is-valid-period (period (string-ascii 32)))
  (and
    (> (len period) u0)
    (is-eq (slice? period u0 u4) (some "20")) ;; Basic check for year start
  )
)

(define-private (is-valid-scope (value uint))
  (and
    (> value u0)
    (<= value MAX-SCOPE-VALUE)
  )
)

(define-private (update-history (company principal) (period (string-ascii 32)))
  (let ((current-history (default-to { periods: (list) } (map-get? report-history { company: company }))))
    (map-set report-history
      { company: company }
      { periods: (unwrap-panic (as-max-len? (append (get periods current-history) period) u100)) }
    )
  )
)

;; Public Functions

(define-public (set-admin (new-admin principal))
  (if (is-admin tx-sender)
    (begin
      (var-set contract-admin new-admin)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (pause-contract)
  (if (is-admin tx-sender)
    (begin
      (var-set paused true)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (unpause-contract)
  (if (is-admin tx-sender)
    (begin
      (var-set paused false)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (add-validator (validator principal) (initial-stake uint))
  (if (is-admin tx-sender)
    (if (is-none (map-get? validators { validator: validator }))
      (begin
        (map-set validators
          { validator: validator }
          { active: true, validation-count: u0, stake: initial-stake }
        )
        (ok true)
      )
      (err ERR-ALREADY-SUBMITTED)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (remove-validator (validator principal))
  (if (is-admin tx-sender)
    (begin
      (map-set validators
        { validator: validator }
        (merge (default-to { active: false, validation-count: u0, stake: u0 } (map-get? validators { validator: validator }))
          { active: false })
      )
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (submit-report (period (string-ascii 32)) (hash (buff 32)) (scope1 uint) (scope2 uint) (scope3 uint) (metadata (string-utf8 1000)))
  (if (var-get paused)
    (err ERR-PAUSED)
    (if (is-some (map-get? emissions-reports { company: tx-sender, period: period }))
      (err ERR-ALREADY-SUBMITTED)
      (if (not (is-valid-period period))
        (err ERR-INVALID-PERIOD)
        (if (or (not (is-valid-scope scope1)) (not (is-valid-scope scope2)) (not (is-valid-scope scope3)))
          (err ERR-INVALID-SCOPE)
          (if (> (len metadata) MAX-METADATA-LEN)
            (err ERR-METADATA-TOO-LONG)
            (if (is-eq (len hash) u32)
              (let ((report-id (var-get report-counter)))
                (map-set emissions-reports
                  { company: tx-sender, period: period }
                  {
                    hash: hash,
                    timestamp: block-height,
                    scope1: scope1,
                    scope2: scope2,
                    scope3: scope3,
                    metadata: metadata,
                    validated: false,
                    amendment-count: u0
                  }
                )
                (update-history tx-sender period)
                (var-set report-counter (+ report-id u1))
                (ok report-id)
              )
              (err ERR-INVALID-HASH)
            )
          )
        )
      )
    )
  )
)

(define-public (amend-report (period (string-ascii 32)) (new-hash (buff 32)) (new-scope1 uint) (new-scope2 uint) (new-scope3 uint) (reason (string-utf8 500)))
  (if (var-get paused)
    (err ERR-PAUSED)
    (match (map-get? emissions-reports { company: tx-sender, period: period })
      report
      (if (> (get amendment-count report) u5) ;; Limit amendments
        (err ERR-NOT-AMENDABLE)
        (if (not (is-eq (len new-hash) u32))
          (err ERR-INVALID-HASH)
          (let ((amendment-id (+ (get amendment-count report) u1)))
            (map-set report-amendments
              { company: tx-sender, period: period, amendment-id: amendment-id }
              {
                new-hash: new-hash,
                new-scope1: new-scope1,
                new-scope2: new-scope2,
                new-scope3: new-scope3,
                reason: reason,
                timestamp: block-height,
                approved: false
              }
            )
            (map-set emissions-reports
              { company: tx-sender, period: period }
              (merge report { amendment-count: amendment-id })
            )
            ;; Hypothetical STX transfer for fee
            (try! (stx-transfer? (var-get amendment-fee) tx-sender (as-contract tx-sender)))
            (ok amendment-id)
          )
        )
      )
      (err ERR-INVALID-AMENDMENT)
    )
  )
)

(define-public (validate-report (company principal) (period (string-ascii 32)))
  (match (map-get? validators { validator: tx-sender })
    validator
    (if (get active validator)
      (match (map-get? emissions-reports { company: company, period: period })
        report
        (if (get validated report)
          (err ERR-ALREADY-SUBMITTED)
          (begin
            (map-set emissions-reports
              { company: company, period: period }
              (merge report { validated: true })
            )
            (map-set validators
              { validator: tx-sender }
              (merge validator { validation-count: (+ (get validation-count validator) u1) })
            )
            (ok true)
          )
        )
        (err ERR-INVALID-PERIOD)
      )
      (err ERR-INVALID-VALIDATOR)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (approve-amendment (company principal) (period (string-ascii 32)) (amendment-id uint))
  (match (map-get? validators { validator: tx-sender })
    validator
    (if (get active validator)
      (match (map-get? report-amendments { company: company, period: period, amendment-id: amendment-id })
        amendment
        (if (get approved amendment)
          (err ERR-ALREADY-SUBMITTED)
          (match (map-get? emissions-reports { company: company, period: period })
            report
            (begin
              (map-set emissions-reports
                { company: company, period: period }
                (merge report {
                  hash: (get new-hash amendment),
                  scope1: (get new-scope1 amendment),
                  scope2: (get new-scope2 amendment),
                  scope3: (get new-scope3 amendment),
                  timestamp: block-height ;; Update timestamp
                })
              )
              (map-set report-amendments
                { company: company, period: period, amendment-id: amendment-id }
                (merge amendment { approved: true })
              )
              (map-set validators
                { validator: tx-sender }
                (merge validator { validation-count: (+ (get validation-count validator) u1) })
              )
              (ok true)
            )
            (err ERR-INVALID-AMENDMENT)
          )
        )
        (err ERR-INVALID-AMENDMENT)
      )
      (err ERR-INVALID-VALIDATOR)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (claim-reduction (period (string-ascii 32)) (reduction uint) (evidence-hash (buff 32)))
  (if (var-get paused)
    (err ERR-PAUSED)
    (if (> reduction u100)
      (err ERR-INVALID-REDUCTION-CLAIM)
      (if (not (is-eq (len evidence-hash) u32))
        (err ERR-INVALID-HASH)
        (match (map-get? emissions-reports { company: tx-sender, period: period })
          report
          (begin
            (map-set reduction-claims
              { company: tx-sender, period: period }
              {
                claimed-reduction: reduction,
                evidence-hash: evidence-hash,
                verified: false
              }
            )
            (ok true)
          )
          (err ERR-INVALID-PERIOD)
        )
      )
    )
  )
)

(define-public (verify-reduction (company principal) (period (string-ascii 32)))
  (match (map-get? validators { validator: tx-sender })
    validator
    (if (get active validator)
      (match (map-get? reduction-claims { company: company, period: period })
        claim
        (if (get verified claim)
          (err ERR-ALREADY-SUBMITTED)
          (begin
            (map-set reduction-claims
              { company: company, period: period }
              (merge claim { verified: true })
            )
            (map-set validators
              { validator: tx-sender }
              (merge validator { validation-count: (+ (get validation-count validator) u1) })
            )
            (ok true)
          )
        )
        (err ERR-INVALID-REDUCTION-CLAIM)
      )
      (err ERR-INVALID-VALIDATOR)
    )
    (err ERR-UNAUTHORIZED)
  )
)

;; Read-Only Functions

(define-read-only (get-report (company principal) (period (string-ascii 32)))
  (map-get? emissions-reports { company: company, period: period })
)

(define-read-only (get-report-history (company principal))
  (map-get? report-history { company: company })
)

(define-read-only (get-amendment (company principal) (period (string-ascii 32)) (amendment-id uint))
  (map-get? report-amendments { company: company, period: period, amendment-id: amendment-id })
)

(define-read-only (get-reduction-claim (company principal) (period (string-ascii 32)))
  (map-get? reduction-claims { company: company, period: period })
)

(define-read-only (is-validated (company principal) (period (string-ascii 32)))
  (match (map-get? emissions-reports { company: company, period: period })
    report (get validated report)
    false
  )
)

(define-read-only (get-total-emissions (company principal) (period (string-ascii 32)))
  (match (map-get? emissions-reports { company: company, period: period })
    report (+ (get scope1 report) (get scope2 report) (get scope3 report))
    u0
  )
)

(define-read-only (get-validator-info (validator principal))
  (map-get? validators { validator: validator })
)

(define-read-only (is-contract-paused)
  (var-get paused)
)

(define-read-only (get-amendment-fee)
  (var-get amendment-fee)
)