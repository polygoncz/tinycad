---
type: adr
status: accepted
number: 26
aliases:
  - ADR 0026
  - Víceprůchodové vykreslování ve viewportu
date: 2026-10-15
related:
  - "[[09-vykreslovani]]"
  - "[[Styl zobrazení]]"
  - "[[Q077 Technika AO]]"
  - "[[M23-postprocessing-a-ao]]"
supersedes:
tags:
  - adr
created: 2026-10-15
updated: 2026-10-15
---
# 0026 – Víceprůchodové vykreslování ve viewportu

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-15)
- **Datum:** 2026-10-15
- **Souvisí:** [[Q077 Technika AO|Q077]], [[09-vykreslovani#Víceprůchodové vykreslování (AO)]], [[Styl zobrazení]], [[M23-postprocessing-a-ao|M23]]

## Kontext

Viewport dnes kreslí jedním `renderer.render(scene, camera)` přímo na plátno a pak přes něj view cube. [[Styl zobrazení]] má v M23 dostat ambient occlusion (AO) a to se počítá z obrazu: potřebuje hloubku a normály modelu, takže model se musí nejdřív vykreslit do render targetu a AO se na něj aplikuje dalším průchodem. Platí tato omezení:

- AO smí ztmavit jen **model**, tedy hlavní vrstvu těles. Zvýraznění, overlay, skici, manipulátory, mřížka a průhledná náhledová vrstva ([[0025-vstupni-stav-editovane-featury|ADR 0025]]) se kreslí až po AO. Hloubku modelu ale dál potřebují: skica za tělesem je zakrytá a zvýraznění plochy leží na ploše.
- Při vypnutém AO se nesmí nic zhoršit: žádný render target, žádná ztráta MSAA, žádná cena navíc.
- Picking (`Raycaster`) a obálka scény pracují s objekty mimo snímek a nesmí poznat, že se vykresluje po částech.
- `GTAOPass` z `three/addons` (three 0.186):
  - Kreslí si vlastní G-buffer (normály a hloubku) celé předané scény.
  - Skrývá v něm jen `Points`, `Line` a `Line2`. `LineSegments2`, tedy naše silné hrany při triangulaci, je `Mesh` a do G-bufferu by se vykreslil jako změť čtverců.
  - Externí G-buffer (`setGBuffer`) je ve 0.186 nepoužitelný, protože sahá na neexistující `normalRenderTarget`.
- `EffectComposer` střídá dva render targety (ping-pong), každý s vlastní hloubkou. U MSAA targetu je hloubka v multisample renderbufferu a sdílený `DepthTexture` ji nesdílí.

## Rozhodnutí

1. **Technika:** `GTAOPass` (z `three/addons`, bez nové závislosti) za `EffectComposer`.
2. **Jeden render target, AO na místě.** Všechny průchody kreslí do **jednoho** render targetu composeru (`HalfFloatType`, `samples: 4`). Žádný z nich nestřídá buffery (`needsSwap = false`), takže hloubka modelu přežije až do průchodu interakcí:
   1. **Model:** vykreslí scénu se skrytými interakcemi, smaže barvu i hloubku.
   2. **AO:** `GTAOPass` s `output = OUTPUT.Off` spočítá jen texturu AO. Náš průchod ji pak vynásobí do barvy targetu (`GTAOBlendShader`, násobení přes `CustomBlending`, bez testu a zápisu hloubky).
   3. **Interakce:** vykreslí scénu se skrytým modelem, **bez mazání** (`clear: false`, hloubka zůstává).
   4. **Výstup:** `OutputPass` (převod do sRGB) na plátno.
   5. View cube se kreslí jako dnes, až po composeru.
3. **Rozdělení scény podle viditelnosti skupin**, ne vrstev (`Object3D.layers`). Viewport skupiny už vlastní a dvě množiny zná:
   - **model** = `layers.main.group`;
   - **interakce** = náhled, zvýraznění, overlay, skici, manipulátory a mřížka.

   Světla a kamera (s headlightem) zůstávají ve scéně vždy. Průchod si stav `visible` skupin uloží, nastaví, vykreslí a v `finally` vrátí. Mimo průchod je scéna nezměněná, takže picking ani obálka nic nepoznají.
4. **G-buffer AO bez `LineSegments2`:** náš obal kolem `GTAOPass` skryje po dobu jeho `render` i viditelné objekty `isLineSegments2` ve skupině modelu. Je to stejný vzor, jakým `GTAOPass` sám skrývá čáry.
5. **Vlastnictví:** pipeline AO vlastní **viewport**. Vzniká líně v prvním snímku s `plan.ao` a uvolní se, když plán AO vypne, a při `unmount`. Velikost dostává z `resize` (`composer.setSize`) a poměr pixelů z rendereru. Při `plan.ao === false` se kreslí jako dnes (jeden `renderer.render`, MSAA plátna).
6. **Antialiasing:** MSAA render targetu (`samples: 4`, WebGL2). FXAA ani SMAA ne, protože rozmazávají jednopixelové hrany.
7. **Parametry AO podle zoomu:** poloměr a tloušťka v `GTAOPass` jsou ve světových jednotkách (mm). Čistá funkce `aoParameters(worldPerPx)` je odvodí z konstant v pixelech. AO tak vypadá stejně při každém zoomu i velikosti modelu, podobně jako čárky skrytých hran.
8. **Přepínač:** jeden `DisplayStyle.ao`, výchozí `false`. Platí v Shaded bez průhlednosti (od M24 i v Realistic), jinde ho `resolveDisplay` ignoruje ([[Q077 Technika AO|Q077]]).

## Zvažované alternativy

- **`Object3D.layers` místo viditelnosti skupin**: vrstvy se nedědí, takže by každý objekt v každé vrstvě (i vytvořený později) musel mít masku nastavenou zvlášť. Výchozí `Raycaster` navíc testuje jen vrstvu 0. Přepnutí `visible` u kořenových skupin pokryje celý podstrom jedním řádkem.
- **Dvě scény** (model a interakce): headlight je potomek kamery a kamera může být jen v jedné scéně. Navíc by se měnilo vlastnictví objektů ve viewportu.
- **Interakce dokreslit po composeru přímo na plátno**: `OutputPass` zapíše na plátno jen barvu, hloubka plátna zůstane prázdná a skici za tělesem by prosvítaly.
- **Ping-pong composeru se sdíleným `DepthTexture`**: u MSAA targetu se hloubka drží v multisample renderbufferu každého targetu zvlášť, takže sdílená textura ji nepřenese.
- **FXAA/SMAA místo MSAA**: rozmazává tenké čáry hran, které jsou v CAD nejdůležitější.
- **`SAOPass`, knihovna `n8ao`**: viz [[Q077 Technika AO|Q077]] (šum a halo, nová závislost).
- **Externí G-buffer z průchodu modelu** (`setGBuffer`, ušetří jedno vykreslení scény): ve three 0.186 nefunguje. Může se vrátit, až se oprava dostane do verze, kterou používáme.

## Důsledky

- \+ Bez AO se nic nemění: stejná cesta, stejná cena, MSAA plátna.
- \+ Hloubka modelu platí i pro interakce, takže zakrytí a zvýraznění se chovají jako v jednom průchodu.
- \+ Picking a obálka scény se nemění. Rozdělení scény žije jen uvnitř snímku.
- \+ Realistic (M24) přidá další průchody do stejné pipeline.
- − S AO se scéna kreslí třikrát (model, G-buffer, interakce) a k tomu dva celoobrazovkové průchody GTAO a odšumění.
- − MSAA target `HalfFloat` stojí paměť, při 2880×1800 řádově stovky MB. Proto existuje jen při zapnutém AO.
- − Obal `GTAOPass` spoléhá na to, které typy objektů `GTAOPass` sám skrývá. Při povýšení three se to musí zkontrolovat (test na `isLineSegments2`).
- − Průchod modelu znovu nastavuje barvu mazání po `setRenderTarget`, protože `RenderPass` maže dřív, než three převede barvu do prostoru targetu. Při povýšení three se to musí zkontrolovat, kontrolu dělá e2e (pozadí s AO a bez něj).
- − Normály v G-bufferu jsou bez MSAA, takže hrana AO může být na obrysu mírně zubatá. Zjemní ji odšumění GTAO.
