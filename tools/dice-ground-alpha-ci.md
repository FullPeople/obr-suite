# Minimal CI job fragment

Parent integration only: add this job on the new diagnostic branch. Do not run
the older 17-scenario/11-variant renderer profile for this experiment. This
fragment does not define a push trigger, merge, deployment, or publication.

```yaml
ground_alpha_diagnostic:
  runs-on: ubuntu-latest
  timeout-minutes: 25
  permissions:
    contents: read
  env:
    DND_CARD_WEB_ROOT: ${{ github.workspace }}/.paired-web
  steps:
    - uses: actions/checkout@v6
      with:
        persist-credentials: false
    - uses: actions/checkout@v6
      with:
        repository: FullPeople/DND-card-web
        ref: 05dcfdb645339cac9f68d1f6009f44b7e63d5c25
        path: .paired-web
        persist-credentials: false
    - uses: actions/setup-node@v4
      with:
        node-version: 22
    - name: Install locked dependencies and official Chromium
      run: |
        npm ci
        npm --prefix .paired-web ci
        npx playwright install --with-deps chromium
    - name: Probe control flow and real SDK/Jolt build
      run: |
        node --check tools/dice-ground-alpha-browser.mjs
        node tools/dice-ground-alpha-probe.test.mjs
        node tools/dice-latency-build.mjs
    - name: Run seven fixed-pose diagnostic cases
      run: node tools/dice-ground-alpha-browser.mjs
    - name: Preserve exact-pixel reports and PNGs
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: dice-ground-alpha-${{ github.sha }}
        include-hidden-files: true
        retention-days: 7
        path: .local-evidence/dice-ground-alpha/
```

A `rejected` probe outcome is a valid experiment result. Do not add an assertion
that every candidate must pass. The runner itself makes fixture/probe faults,
an unexercised true-clamp refusal, and restoration faults fail the job.

The runner has not been launched locally: AF_UNIX EPERM is an explicit local
browser restriction, and actual browser work is reserved for authorized CI.
