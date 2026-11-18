# NEWSFLUX-AI-SETTINGS-01 — PM/Red Team R4.1: atualização posterior ao handoff, #267 preferida

**Evento:** `2026-11-18/NEWSFLUX/R41-PM-PR266-PR267-RECONCILIATION`, America/Bahia.  
**Escopo:** análise GitHub independente, sem acesso OMV, sem deploy/merge/inferência/chave real. Reconciliar com [handoff original](NEWSFLUX_AI_SETTINGS_01_R41_HANDOFF.md), preservando-o como histórico.  
**Main confirmada:** `d54eda2bdb8bc5c3d1bd58d40236f48da762e852`; PRs #260–#267 DRAFT, não mergeadas no instante da revisão. #260 explicitamente HOLD.

## Evidências confirmadas por GitHub

- **P0 #265 @ `4c3e07529d706ffc37115aa8de808f36cccdc244`:** o preflight `python -I` adiciona raiz fixa `/app` após checagem de ownership root, não-symlink e não-gravação por group/other de `/app/services` e transitivos; desliga bytecode; auditoria posterior dos `services.*` importados. Dockerfile da Summary COPY sob root e `USER 10001:10001`. Antes dessa revisão, `896d1dc` foi seguido de dois commits que alteram só preflight/testes, sem force push. GitHub Actions exato: release [44350156006](https://github.com/jfsdias/NewsFlux/actions/runs/44350156006), Quality [44350156064](https://github.com/jfsdias/NewsFlux/actions/runs/44350156064), pilot [44350155988](https://github.com/jfsdias/NewsFlux/actions/runs/44350155988), E2E [44350156502](https://github.com/jfsdias/NewsFlux/actions/runs/44350156502), linter [44350156632](https://github.com/jfsdias/NewsFlux/actions/runs/44350156632): SUCCESS. O `OMV_READONLY_PREFLIGHT` continua **não executado**.
- **P1 #266 @ `4143e3c4cc276a40ebef96c034ddae9c73a99c98`:** CI Quality [44351237672](https://github.com/jfsdias/NewsFlux/actions/runs/44351237672) SUCCESS; altera só `services/article_intel_summary/tests/test_api_supervision.py`, corrige timing do teste de inferência, mas deixa o teste irmão `test_timeout_keeps_capacity_until_worker_finishes` sem relógio controlado. **REPORTED_AGENT:** segunda análise sob carga CPU+I/O observou 4/60 falhas desse irmão. Não é prova do PM reproduzida.
- **P1 #267 @ `f9926a20c0cbe2a8f2fb5adcc14ced1d38d18a89`:** também altera só o mesmo arquivo, **é alternativa concorrente**. Código inclui relógio controlado nos dois testes, regressão com latência antes do adapter e caso negativo expiração pré-dispatch que exige 504, nenhum gateway send, reserva `uncertain`. CI exato Quality [44354156865](https://github.com/jfsdias/NewsFlux/actions/runs/44354156865), pilot [44354157039](https://github.com/jfsdias/NewsFlux/actions/runs/44354157039), E2E [44354156917](https://github.com/jfsdias/NewsFlux/actions/runs/44354156917), fallback [44354156866](https://github.com/jfsdias/NewsFlux/actions/runs/44354156866), lint [44354156854](https://github.com/jfsdias/NewsFlux/actions/runs/44354156854): SUCCESS. **REPORTED_AGENT:** 0/150 sob stress combinado (não execução independente PM).
- **Lacuna de integração:** tree `011c01cf8c8c84b07a0cda056539e062bc645670` tem **#266**, não #267; CI workflow_dispatch release [44351749588](https://github.com/jfsdias/NewsFlux/actions/runs/44351749588), pilot [44351758184](https://github.com/jfsdias/NewsFlux/actions/runs/44351758184), E2E [44351877599](https://github.com/jfsdias/NewsFlux/actions/runs/44351877599), fallback [44351773281](https://github.com/jfsdias/NewsFlux/actions/runs/44351773281) foram conferidos no REST GitHub e apontam para esse SHA. A outra tree `233214259b122f57e756df4e1e6dec4e4989f846` com #267 incorpora **#265 antes de `4c3e075`** e não resolve o gate final. A #261 foi atualizada para `cdb56e91288fd7f81286b14c630cf256581e79ab` (CI atual green) e seu handoff recomenda equivocadamente #266 antes do achado novo.
- **Dependência de PR:** #263 continua `base=codex/newsflux-ai-settings-backend-r1` (stacked sobre #262). Nunca fazer merge direto da #263 enquanto retarget/rebase/CI de base main estiver pendente. #264 e #261 são independentes e necessitam rebase/CI após mudanças em main.

## Decisão independente PM

**`P1_PREFERRED=#267`; `#266=SUPERSEDED_CANDIDATE` apenas por preferência técnica, sem fechamento automático. `MERGE_READY_CHAIN=HOLD`; `DEPLOY=HOLD`; `OMV_READONLY_PREFLIGHT=NOT_EXECUTED`.** Não há P0 novo confirmado no hardening #265. Mas **nenhuma árvore existente prova a combinação final**. Não importar os números de stress 0/150 como prova estatística de ausência total de race. A autorização condicional de merge atribuída ao proprietário em [comentário #267](https://github.com/jfsdias/NewsFlux/pull/267#issuecomment-6986801829) é **REPORTED_OWNER_CONDITIONAL_INTENT**, não satisfaz a condição técnica enquanto o gate falha.

**Próximo sprint restrito e único (sem GO de merge ou OMV):**
1. Preparar uma tree descartável **a partir de main exata**, com #267 @ `f9926a2`, #265 @ `4c3e075`, #262 @ `683d60c`, #263 delta contra #262 @ `8b7960d`, #264 @ `2641010`, #261 @ `cdb56e9`. **Excluir #266 e #260**. Sem force push, merge main, deploy, token ou alteração de PR.
2. Registrar SHA exato da tree e executar os workflows release rehearsal, pilot, E2E e fallback no **novo** SHA; Quality/lint (e testes negativos de timeout) no próprio SHA, por GitHub Actions quando configurado ou local com evidência de comando/ambiente. Não reutilizar evidências de `011c01c` como se fossem da tree nova.
3. Demonstrar que #267 não alterou o comportamento do produto (test-only) nem relaxou deadlines; checar estabilidade de ambos os testes em stress CPU+I/O sem substituir por simples 1× PASS.
4. Revisar em conjunto #265 commits de dois agentes, perda de `-I`, import path, ownership e possíveis efeitos colaterais; preservar `UNSAFE_IMPORT_PATH→HOLD`. Confirmar que #260 privacidade, NewsFlux/MiniFlux, NPM proxy hosts protegidos e WallHop não são alterados.
5. Preparar preflight **somente leitura** do OMV com o SHA correto e sem `git clone` como root; `codex-ha` **não tem sudo nem Docker** de acordo com ledger, logo a execução root separada exige uma decisão/GO próprio ou operador legitimamente autorizado. Quando feito, coletar apenas linhas sanitizadas e FAIL/HOLD sem flexibilizar.
6. Atualizar documentação de #261 com um **adendo** da preferência #267; registrar nos dois repositórios com readback. Depois de evidência final, PM reavalia o GO de merges da sequência **#267 → #265 → #262 → #263 (retarget) → #264 → #261**, CI por merge e release GO/produção separado.

Sem desvio de execução: nenhuma PR mergeada/fechada/retargeted nesta revisão.

```ini
R41_P0_265=SOURCE_REVIEW_PASS_CI_CONFIRMED
P1_PREFERRED=PR267
P1_PR266=DO_NOT_MERGE_BOTH
P1_STRESS=AGENT_REPORTED_NOT_PM_REPRODUCED
EXACT_FINAL_INTEGRATION=NOT_YET_VERIFIED
OMV_PREFLIGHT=NOT_EXECUTED
OWNER_CONDITIONAL_MERGE_INTENT=REPORTED_NOT_CONSUMED
MERGE_READY_CHAIN=HOLD
DEPLOY=HOLD
PR260=HOLD_UNTOUCHED
NEXT_GATE=R41_FINAL_EXACT_HEAD_INTEGRATION_AND_PREFLIGHT
```
