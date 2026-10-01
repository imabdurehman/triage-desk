# Phase 0: skeleton `main` par, aur `develop` branch

Sirf ek dafa, aur sirf ek banda (repo ka owner). Agar `main` par pehle se `shared/contract.json`, `CONTRACT.md` aur `AI_RULES.md` hain, to yeh phase chhor dein; bas `develop` maujood hona chahiye.

```powershell
cd D:\triage-desk
git checkout main
git pull
```

Is folder (`00-skeleton`) ki **saari** files (yeh `STEPS.md` chhor kar) repo mein copy karein, phir:

```powershell
git add -A
git commit -m "chore: project skeleton, shared contract, AI rules"
git push
git checkout -b develop
git push -u origin develop
```

GitHub par **Settings → Branches** mein `main` aur `develop` par yeh rule lagayen ke merge sirf pull request se ho. Ab Phase 1 shuru karein.
