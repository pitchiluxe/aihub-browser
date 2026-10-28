// La lecture du mois, en français — the words around each month's reading for
// Louis Segond readers. The readings and the verse are the same as in English
// (bibleMonthlyPlan.ts); only what is said about them changes.

export interface MonthWordsFr {
  title: string
  tagline: string
  intro: string
  weeks: [string, string, string, string, string]
}

export const MONTH_WORDS_FR: Record<number, MonthWordsFr> = {
  1: {
    title: 'Au commencement',
    tagline: 'Une nouvelle année, lue depuis la première page',
    intro: 'Toutes les histoires que Dieu raconte commencent par une parole prononcée sur le vide — et la lumière répond. Commencez l’année là où l’Écriture commence : la création, une promesse faite à Abraham, un rêveur vendu en Égypte qui vivra pour dire « vous aviez médité de me faire du mal, Dieu l’a changé en bien ». Quoi que cette année vous réserve, ce n’est pas le premier commencement que Dieu tient entre ses mains.',
    weeks: [
      'La lumière avant le soleil. Ce qui est encore informe dans votre vie n’échappe pas à sa voix.',
      'Abraham marche sans carte. La foi, c’est le pas suivant, pas toute la route.',
      'Jacob lutte et repart en boitant, béni. Dieu n’a pas peur de vos questions.',
      'Joseph dans la citerne et dans la prison — et jamais hors du regard de Dieu.',
      'Les dernières pages de la Genèse : ce qui était fait pour nuire, changé en bien.',
    ],
  },
  2: {
    title: 'Aimés les premiers',
    tagline: 'Le mois de l’amour, avec Celui qui l’a inventé',
    intro: 'Avant que vous aimiez qui que ce soit, vous avez été aimé. Février lit les histoires d’amour de l’Écriture — la fidélité de Ruth, l’obstination fidèle d’Osée, le père du fils prodigue qui court sur la route — et se termine dans les lettres de Jean, qui s’appuyait sur la poitrine de Jésus et passa sa vieillesse à répéter une seule chose : aimez-vous les uns les autres.',
    weeks: [
      'Ruth choisit un peuple et un Dieu. L’amour fidèle est une décision avant d’être un sentiment.',
      'Osée rachète sans cesse une épouse qui s’en va. C’est ainsi que Dieu vous aime.',
      'La chambre haute : Jésus lave les pieds, puis les appelle ses amis.',
      'Enracinés et fondés dans l’amour — plus large, plus long, plus haut, plus profond que vous ne le savez.',
      'Un jour de plus cette année — passez-le à vous reposer dans cet amour.',
    ],
  },
  3: {
    title: 'Revenez à moi',
    tagline: 'Une saison pour faire demi-tour',
    intro: 'Déchirez vos cœurs et non vos vêtements. Mars est un mois pour rentrer à la maison — avec l’appel de Joël au retour, la miséricorde que Jonas accorde à contrecœur, et l’Évangile de Luc où ce qui était perdu est retrouvé. La repentance n’est pas une punition : c’est le chemin du retour vers un Père qui le guette.',
    weeks: [
      'Joël : maintenant encore, revenez. Il n’est jamais trop tard pour faire demi-tour.',
      'Jonas s’enfuit ; Dieu le suit. On ne peut pas distancer la miséricorde.',
      'Chez Luc, Jésus mange avec ceux que tout le monde évitait.',
      'La brebis perdue, la drachme perdue, le fils perdu — et la joie quand ils sont retrouvés.',
      'Jérusalem, la croix et un tombeau vide. Le chemin du retour est ouvert.',
    ],
  },
  4: {
    title: 'De nouveau vivants',
    tagline: 'La résurrection, et ce qu’elle change',
    intro: 'Le tombeau est vide, et tout est donc différent. Avril marche avec Jean depuis la première lumière de la création jusqu’au repas sur la plage avec le Christ ressuscité, puis lit ce que les apôtres ont écrit une fois qu’ils ont compris : nous sommes régénérés pour une espérance vivante.',
    weeks: [
      'Au commencement était la Parole — et la Parole s’est approchée.',
      'Eau vive, pain de vie, lumière du monde. Il est ce dont vous avez faim.',
      'Le bon berger donne sa vie ; Lazare sort de son tombeau.',
      'Un matin au bord de la mer : le Seigneur ressuscité prépare le repas pour l’ami qui l’a renié.',
      'Morts au péché, vivants pour Dieu. Vivez comme quelqu’un qui a été relevé.',
    ],
  },
  5: {
    title: 'La sagesse de chaque jour',
    tagline: 'Un chapitre des Proverbes pour chaque jour de mai',
    intro: 'Les Proverbes ont trente et un chapitres, et mai a trente et un jours. Lisez celui de la date du jour. Ce ne sont pas de grandes théories : ce sont des paroles pour la cuisine, le bureau, le marché et la dispute — la crainte de l’Éternel vécue dans la vie ordinaire.',
    weeks: [
      'La sagesse crie dans les rues. Elle ne se cache pas — elle attend qu’on la demande.',
      'Garde ton cœur plus que toute autre chose, car de lui viennent les sources de la vie.',
      'Une réponse douce calme la fureur. Veillez sur vos paroles cette semaine.',
      'Le fer aiguise le fer. Qui vous aiguise — et qui aiguisez-vous ?',
      'Elle est revêtue de force et de gloire, et elle se rit de l’avenir.',
    ],
  },
  6: {
    title: 'Le feu et le vent',
    tagline: 'L’Esprit répandu sur des gens ordinaires',
    intro: 'Des pêcheurs et des collecteurs d’impôts, remplis de l’Esprit, ont bouleversé le monde. Juin lit les Actes des apôtres — la Pentecôte, des portes de prison qui s’ouvrent, l’Évangile qui franchit toutes les frontières — et se termine avec Romains 8 et Galates 5, où ce même Esprit habite en vous.',
    weeks: [
      'Le vent et le feu de la Pentecôte. La promesse est pour vous et pour vos enfants.',
      'Étienne voit les cieux ouverts. Le courage est un don de l’Esprit, pas un trait de caractère.',
      'Saul est arrêté sur la route. Personne n’est trop loin.',
      'Paul et Silas chantent à minuit, enchaînés — et les portes s’ouvrent.',
      'Aucune condamnation, et rien ne peut nous séparer. Marchez selon l’Esprit.',
    ],
  },
  7: {
    title: 'Libérés',
    tagline: 'La grande histoire de la liberté',
    intro: 'Israël criait sous le fouet, et Dieu a entendu. Juillet suit l’Exode — le buisson ardent, les plaies, la mer dressée comme une muraille, la loi donnée au Sinaï — puis la lettre de Paul aux Galates, qui dit que ce même Dieu vous a libéré et que vous ne devez pas retourner en arrière.',
    weeks: [
      'Un buisson qui brûle sans se consumer. Dieu a vu votre souffrance.',
      'Dix plaies et le sang de l’agneau sur les portes. La délivrance a un prix, et c’est Dieu qui le paie.',
      'La mer s’ouvre. Restez en place, et regardez la délivrance que l’Éternel va accomplir.',
      'Au Sinaï, la liberté reçoit une forme : aimer Dieu, aimer son prochain.',
      'C’est pour la liberté que Christ nous a affranchis. Demeurez fermes.',
    ],
  },
  8: {
    title: 'Le repos de l’âme',
    tagline: 'Trente et un psaumes pour les jours plus lents',
    intro: 'Le premier livre des Psaumes — des chants pour le matin et pour la nuit, pour quand les ennemis se rapprochent et quand les cieux racontent la gloire de Dieu. Lisez-en un par jour, lentement. Priez-le à votre tour. Août, c’est pour être conduit près des eaux paisibles.',
    weeks: [
      'Heureux l’homme planté près d’un courant d’eau. Enracinez-vous.',
      'Je me couche, et je m’endors ; je me réveille, car l’Éternel est mon soutien.',
      'Les cieux racontent la gloire de Dieu. Levez les yeux cette semaine.',
      'L’Éternel est mon berger. Laissez-le vous conduire.',
      'Je remets mon esprit entre tes mains. Reposez-vous.',
    ],
  },
  9: {
    title: 'Fortifie-toi et prends courage',
    tagline: 'Entrer dans une nouvelle saison sans crainte',
    intro: 'Septembre est un mois de recommencements — l’école, le travail, le changement de saison. Josué prend la place de Moïse, face à un pays rempli de géants, et Dieu lui dit trois fois de ne pas avoir peur. Puis Daniel, loin de chez lui, reste fidèle à la cour d’un roi étranger et dans la fosse aux lions.',
    weeks: [
      'Fortifie-toi et prends courage. L’Éternel ton Dieu est avec toi partout où tu iras.',
      'Jéricho tombe au son des trompettes et des pas. Les voies de Dieu ne sont pas les nôtres.',
      'Moi et ma maison, nous servirons l’Éternel.',
      'Daniel résolut de ne pas se souiller. Petite fidélité, grandes conséquences.',
      'La gueule des lions est fermée. Votre Dieu est capable.',
    ],
  },
  10: {
    title: 'Le temps de la moisson',
    tagline: 'Semer, attendre et récolter',
    intro: 'Les champs deviennent dorés et la moisson rentre. Octobre lit Matthieu, où Jésus parle de semeurs et de semences, de blé et d’ivraie, d’une moisson abondante quand les ouvriers sont peu nombreux — puis Jean 15, Jacques et Galates 6 : ne nous lassons pas de faire le bien. Nous moissonnerons au temps convenable.',
    weeks: [
      'Le Sermon sur la montagne : une moisson pousse de ce que l’on plante dans le secret.',
      'Venez à moi, vous tous qui êtes fatigués. Prenez son joug — il est doux.',
      'Le semeur sème la parole. Qu’elle tombe en vous dans la bonne terre.',
      'Demeurez dans le cep. Le fruit vient quand on reste attaché.',
      'Ne nous lassons pas de faire le bien. La saison arrive.',
    ],
  },
  11: {
    title: 'Un cœur reconnaissant',
    tagline: 'Un mois pour rendre grâces',
    intro: 'La reconnaissance n’est pas un sentiment qui arrive quand la vie va bien ; c’est une pratique qui change notre regard sur la vie. Novembre chante les grands psaumes de louange — « Entrez dans ses portes avec des louanges » — puis lit Paul, qui écrivait « réjouissez-vous toujours » depuis une prison. Rendez grâces en toutes choses.',
    weeks: [
      'Venez, chantons avec allégresse à l’Éternel. Commencez chaque jour de cette semaine par un sujet de reconnaissance.',
      'Mon âme, bénis l’Éternel, et n’oublie aucun de ses bienfaits. Comptez-les.',
      'Réjouissez-vous toujours dans le Seigneur. La reconnaissance est un choix avant d’être un sentiment.',
      'Que la paix de Christ règne dans vos cœurs — et soyez reconnaissants.',
      'Rendez grâces en toutes choses. Terminez le mois comme vous l’avez commencé.',
    ],
  },
  12: {
    title: 'L’attente du Roi',
    tagline: 'L’Avent : de la promesse à la crèche',
    intro: 'Pendant des siècles, le peuple de Dieu a attendu dans l’obscurité que la promesse soit tenue. Décembre lit les prophéties de consolation d’Ésaïe et la venue du Roi pendant vingt-trois jours d’Avent — puis Luc 1 la veille de Noël, la crèche le jour de Noël, et la dernière semaine de l’année sur qui est vraiment cet enfant.',
    weeks: [
      'Consolez, consolez mon peuple. L’attente n’est pas perdue.',
      'Il était blessé pour nos péchés. Le Roi vient pour souffrir.',
      'Lève-toi, sois éclairée, car ta lumière arrive.',
      'Un enfant nous est né. Faites-lui de la place.',
      'La Parole a été faite chair. Voici, il fait toutes choses nouvelles.',
    ],
  },
}
