---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M12-skicar]]"
proposal: "Editace skici jako feature.setParams přes FeatureEditSession.setParams, bez vlastních operací sketch.*"
decision: "M12 bez operací sketch.* a bez FeaturePlugin.ops; editace skici je feature.setParams v jedné transakci"
tags:
  - otazka
created: 2026-10-14
updated: 2026-10-14
---
# Q074 Operace skicáře v logu

**Oblast:** [[12-skicar]] · **Rozhodnout do:** [[M12-skicar]]

## Otázka

Hrubý návrh [[12-skicar]] počítal s vlastními [[Operace|operacemi]] skici (`sketch.addEntities`, `sketch.moveSolved`…) registrovanými pluginem (`FeaturePlugin.ops`), „aby byl log čitelný a jemný“. Potřebujeme je v M12, nebo stačí `feature.setParams` s celými parametry skici?

## Možnosti a návrh

- **Vlastní operace `sketch.*`** – jemné záznamy, ale celá editace skici je stejně jedna [[Transakce|transakce]], takže v logu vznikne `batch` desítek až stovek drobných operací (každý snímek tažení je `moveSolved`). Potřebuje `FeaturePlugin.ops`, registraci handlerů pluginu v `app`, závislost `plugin-api → ops` a migrace dalších typů operací navždy.
- **`feature.setParams`** – transakce sloučí po sobě jdoucí `setParams` téže featury (`merge`), takže editace skici je v logu `batch[feature.add, feature.setParams]` (nová skica) nebo jediné `feature.setParams` (úprava) s konečnými vyřešenými daty. Determinismus platí (data jsou vyřešená). Nic nového v `ops` ani `plugin-api`.

Návrh: `feature.setParams`. Přibude jen `FeatureEditSession.setParams(patch)` (více parametrů jednou operací).

## Rozhodnutí

Rozhodnuto 2026-10-14 (noční rychloakce, [[Rozhodnutí noční rychloakce#M12 – Skicář|R36]] ⚠ k revizi): **M12 nemá operace `sketch.*` ani `FeaturePlugin.ops`.** Editace skici zapisuje `feature.setParams` přes `FeatureEditSession.setParams({ entities, constraints })`; log je menší a čitelný na úrovni „skica se změnila“. Jemné operace přijdou, až budou mít spotřebitele (kolaborace, rozdíly verzí). Propsáno do [[12-skicar#Operace a transakce]], [[04-operace-a-historie#Sada operací]] a [[11-ui#Plugin featury (plugin-api)]].
