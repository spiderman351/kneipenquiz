// Fragenkatalog. Jede Runde: title, optional est: true (Schätzrunde, 2 Punkte für die nächste Schätzung),
// questions: [{ q: Frage, a: Antwort, note: optionaler Zusatz, points: optional }].
window.QUIZ_ROUNDS = [
  { title: 'Wo kommt Halloween her?', questions: [
    { q: 'Aus welchem Land stammt der Halloween-Brauch ursprünglich?', a: 'Irland' },
    { q: 'Wie heißt das keltische Fest, aus dem Halloween hervorgegangen ist?', a: 'Samhain' },
    { q: 'Welches Gemüse wurde in Irland ausgehöhlt, bevor man Kürbisse nahm?', a: 'Rüben', note: 'Meist Steckrüben. Kürbisse kamen erst in Amerika dazu.' },
    { q: 'Nach welcher Sagenfigur ist die Kürbislaterne benannt?', a: 'Jack', note: '„Jack O’Lantern“, der geizige Jack, der mit einer Laterne umherirrt.' },
    { q: 'Welcher Feiertag folgt am Tag nach Halloween?', a: 'Allerheiligen', note: 'Am 1. November. „Halloween“ kommt von „All Hallows’ Eve“.' },
  ]},
  { title: 'Monster & Mythen', questions: [
    { q: 'Wer schrieb den Roman „Frankenstein“?', a: 'Mary Shelley' },
    { q: 'Wie lautet der Vorname von Doktor Frankenstein?', a: 'Victor' },
    { q: 'Aus welcher Region stammt Graf Dracula?', a: 'Transsilvanien', note: 'Auf Deutsch auch Siebenbürgen, heute in Rumänien.' },
    { q: 'Wer schrieb den Roman „Dracula“?', a: 'Bram Stoker' },
    { q: 'Womit lässt sich ein Werwolf der Legende nach töten?', a: 'Mit einer Silberkugel' },
  ]},
  { title: 'Horrorfilme', questions: [
    { q: 'Wie heißt der Clown aus Stephen Kings „Es“?', a: 'Pennywise' },
    { q: 'In welchem Hotel spielt „Shining“?', a: 'Overlook Hotel' },
    { q: 'Wie heißt der Killer mit dem Klingenhandschuh aus „Nightmare on Elm Street“?', a: 'Freddy Krueger' },
    { q: 'Welches Gesicht steckt hinter der Maske von Michael Myers im ersten „Halloween“-Film?', a: 'Captain Kirk', note: 'Eine weiß angemalte William-Shatner-Maske aus „Star Trek“.' },
    { q: 'Wie heißt der kleine Junge in „The Sixth Sense“, der tote Menschen sieht?', a: 'Cole', note: 'Gespielt von Haley Joel Osment.' },
  ]},
  { title: 'Allgemeinwissen', questions: [
    { q: 'Wie viele Tasten hat ein klassisches Klavier?', a: '88' },
    { q: 'Wie heißt die Hauptstadt von Kanada?', a: 'Ottawa' },
    { q: 'Welches chemische Element hat das Symbol „Au“?', a: 'Gold' },
    { q: 'Welcher Planet ist der Sonne am nächsten?', a: 'Merkur' },
    { q: 'Wie viele Knochen hat ein erwachsener Mensch?', a: '206' },
  ]},
  { title: 'Berlin', questions: [
    { q: 'In welchem Jahr fiel die Berliner Mauer?', a: '1989', note: 'Am 9. November.' },
    { q: 'Wie heißt das Gespann, das oben auf dem Brandenburger Tor steht?', a: 'Die Quadriga' },
    { q: 'Welcher stillgelegte Flughafen ist heute ein riesiger Park?', a: 'Tempelhof' },
    { q: 'Welcher Fluss fließt durch die Berliner Innenstadt?', a: 'Die Spree' },
    { q: 'Nach welchen zwei Brüdern ist die Humboldt-Universität benannt?', a: 'Wilhelm und Alexander von Humboldt' },
  ]},
  { title: 'Schätzfragen', est: true, questions: [
    { q: 'In welchem Jahr erschien Mary Shelleys „Frankenstein“?', a: '1818' },
    { q: 'In welchem Jahr kam John Carpenters „Halloween“ ins Kino?', a: '1978' },
    { q: 'Wie hoch ist der Berliner Fernsehturm, in Metern?', a: '368 m' },
    { q: 'Wie lang war die Grenzanlage rund um West-Berlin, in Kilometern?', a: 'rund 155 km' },
    { q: 'Wie viele Augen hat ein Spielwürfel, wenn man alle sechs Seiten zusammenzählt?', a: '21' },
  ]},
];
