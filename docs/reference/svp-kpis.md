# SVP reference (summary of a real distributor's monthly file)

The owner received a monthly "SVP" Excel file (October 2019) from the leaders of a beverage distribution company. It is the model for phase 40. The file itself is **not** in the repo (it has real people's and clients' names); this page keeps only its structure and a few numbers useful as test fixtures.

## How the company is organised in the file
- **Canal** = kind of route / client: Détail mixte 01–05, Exclusif (one brand), Horeca 01–03, Self-service, Demi-gros 01–02, Gros. Each Détail / Horeca route is **one van, one vendeur** (the "aide vendeur" is only the driver).
- **Routing**: each route has one secteur (quartier or commune) per weekday, e.g. Samedi "Sonitex", Dimanche "1000 Logts", Lundi "700 logts"… Friday is off.
- **Products** are followed in **caisses** per family and format: SODA PET 2L / 1L / 33CL, SODA VERRE 1L / 25CL, CANETTE 33CL, JUS PET 2L / 1L, JUS VERRE 1L / 25CL, EAU 5L / 2L / 1,5L / 0,5L, SIROP 1L; and per parfum inside a format.

## Sheets → figures
| Sheet | Figures |
|---|---|
| Actualisations | jours ouvrables (27), jours travaillés, jours restants, temps écoulé %; objectif global CA TTC and per day; objectif per canal per format in caisses; routing per vendeur per weekday; prix de vente per canal (Détail, Self-service, Demi-gros, Super-gros) |
| Consolidé wilaya | per canal: jours travaillés, factures (objectif / réalisation / moyenne par jour / %), per family objectif mensuel / réalisation / moyenne par jour / %, total volume, poids par canal en caisse; totals per canal type (Total détail, Total horeca…) and Total wilaya; ventes par parfum, par produit, moyenne ventes par format, objectif par format; réalisation par produit en CA per canal; poids par canal en CA |
| Ventes | per route, per day: caisses per product / parfum, total caisses, total CA |
| Performances | per day: visites objectif / réalisées / productives; per route (and per secteur): jours perdus / travaillés, programmées, réalisées, factures, moyenne facture, drop size (caisses / facture), facture en valeur (CA / facture), taux de succès (factures / visites), couverture % (réalisées / programmées); drop size par produit par canal; per month: moyenne facture, drop size, facture en valeur; MTD vs Q4 Y-1 vs each month |
| Atte | atterrissage du mois per canal (total, moyenne par jour, jours restants) |
| Suivi Gros & D-G | per gros / demi-gros: univers clients, volume, nombre de clients actifs, sales per family |
| D-M 01…05, H-1…3, S-S, DG-1/2, Gros, Exclusif | the same tables as Consolidé for one route / canal |
| Prix | prix de vente and "retenu" per format per canal |
| PA | plan d'action: canal, constat, objectif, action, avancement, responsable, date (phase 40: parked) |
| P-H | weekly planning (jour, programme, lieu, objectif, statut) + veille concurrentielle (phase 40: parked) |

## Numbers usable as fixtures (Détail mixte 01, October)
- 27 jours travaillés, objectif factures 567, réalisées 340 → 60 %, 12,64 factures / jour.
- SODA: objectif 2 296 caisses, réalisation 1 836 → 80 %, 68 caisses / jour.
- Visites programmées 1 136, réalisées 1 136 → couverture 100 %; factures 340 → taux de succès 29,9 %.
- Route total: 12 433 caisses, 1 969 factures, CA 6 061 507 DA → drop size 6,31 caisses, facture en valeur 3 078 DA.
