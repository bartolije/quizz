// Test de charge / répète du mode buzzer (partie famille).
//
// Pilote une partie COMPLÈTE en autonomie contre un serveur qui tourne :
//   1 host + N participants "bots". À chaque ouverture du buzzer, TOUS les bots
//   buzzent en même temps → on valide la course (exactement 1 gagnant), la
//   diffusion à N sockets, et on mesure la latence de verrouillage.
//
// Prérequis : un serveur lancé (npm run dev, ou node dist) avec un quiz buzzer
// en base (le seed "Quiz famille (démo buzzer)" suffit).
//
// Usage :
//   node packages/server/scripts/buzzer-loadtest.mjs
//   URL=http://localhost:3001 ADMIN_PW=dev N=17 node packages/server/scripts/buzzer-loadtest.mjs
//   QUIZ_ID=<id> N=30 node packages/server/scripts/buzzer-loadtest.mjs

import { io } from 'socket.io-client'
import { EVENTS, CULTURE_THEME } from '@lya-quiz/shared'

const URL = process.env.URL || 'http://localhost:3001'
const ADMIN_PW = process.env.ADMIN_PW || 'dev'
const N = Number(process.env.N || 17)
const CHURN = Number(process.env.CHURN || 0) // nb de clients qui se déco/reconnectent en pleine partie
const STEP_MS = Number(process.env.STEP_MS || 120) // délai entre actions host (rythme d'animation)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const connect = () => io(URL, { transports: ['websocket'], forceNew: true, reconnection: false })
const waitEvent = (sock, ev, ms = 5000) =>
  new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms)
    sock.once(ev, (p) => { clearTimeout(to); res(p) })
  })

async function findBuzzerQuizId() {
  if (process.env.QUIZ_ID) return process.env.QUIZ_ID
  const list = await (await fetch(`${URL}/api/admin/quizzes`, { headers: { 'x-admin-password': ADMIN_PW } })).json()
  for (const q of list) {
    const detail = await (await fetch(`${URL}/api/admin/quizzes/${q.id}`, { headers: { 'x-admin-password': ADMIN_PW } })).json()
    if (detail.gameType === 'buzzer') return q.id
  }
  throw new Error('Aucun quiz buzzer en base (lance le serveur pour seeder la démo, ou passe QUIZ_ID).')
}

async function main() {
  const quizId = await findBuzzerQuizId()
  const { pin, hostKey } = await (await fetch(`${URL}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quizId }),
  })).json()
  console.log(`▶ Session ${pin} · quiz ${quizId} · ${N} bots`)

  // Host — on pose le listener buzz_themes AVANT le join (comme le vrai client),
  // sinon le buzz_themes émis juste après session_joined peut être manqué.
  const host = connect()
  let latestThemes = null
  host.on(EVENTS.BUZZ_THEMES, (t) => { latestThemes = t })
  host.emit(EVENTS.HOST_JOIN, { pin, hostKey })
  await waitEvent(host, EVENTS.SESSION_JOINED)
  for (let i = 0; i < 60 && !latestThemes; i++) await sleep(50)
  if (!latestThemes) throw new Error('aucun buzz_themes reçu après le host_join')

  // Bots — chacun mémorise ce QU'IL voit : nb de révélations reçues + classement
  // final (pour vérifier que tout le monde voit la même chose que le serveur).
  const bots = []
  for (let i = 0; i < N; i++) {
    const c = connect()
    const bot = { sock: c, id: null, token: null, reveals: 0, finalLb: null, churned: false }
    c.on(EVENTS.BUZZ_QUESTION_ENDED, () => { bot.reveals++ })
    c.on(EVENTS.LEADERBOARD_UPDATE, (p) => { if (p.final) bot.finalLb = p.scores })
    c.emit(EVENTS.JOIN_SESSION, { pin, pseudo: `bot${i + 1}`, sessionToken: null })
    const joined = await waitEvent(c, EVENTS.SESSION_JOINED)
    bot.id = joined.participant.id
    bot.token = joined.sessionToken
    bots.push(bot)
  }
  console.log(`✓ ${bots.length} bots connectés`)

  // Compte les erreurs éventuelles côté bots/host
  let errors = 0
  ;[host, ...bots.map((b) => b.sock)].forEach((s) => s.on(EVENTS.QUIZ_ERROR, () => { errors++ }))

  // Attribution des thèmes perso aux bots (round-robin) — latestThemes est déjà
  // tenu à jour par le listener posé plus haut.
  latestThemes.owners.forEach((o, k) => {
    host.emit(EVENTS.HOST_ASSIGN_OWNER, { ownerName: o.ownerName, participantId: bots[k % bots.length].id })
  })
  await sleep(300)

  // Métriques de course + d'information
  const latencies = []
  let races = 0, locks = 0, badWinner = 0, buzzArmedAt = 0
  let pointsAwarded = 0, hostFinalLb = null, churnStarted = false
  host.on(EVENTS.LEADERBOARD_UPDATE, (p) => { if (p.final) hostFinalLb = p.scores })

  // Reconnexion sous charge : un client se déconnecte puis rejoint par token.
  const reconnectBot = async (bot) => {
    bot.churned = true
    bot.sock.disconnect()
    await sleep(250)
    const c2 = connect()
    bot.sock = c2
    c2.on(EVENTS.BUZZ_QUESTION_ENDED, () => { bot.reveals++ })
    c2.on(EVENTS.LEADERBOARD_UPDATE, (p) => { if (p.final) bot.finalLb = p.scores })
    c2.on(EVENTS.QUIZ_ERROR, () => { errors++ })
    c2.emit(EVENTS.REJOIN_SESSION, { sessionToken: bot.token })
  }

  const pickNext = (t) => {
    const o = t.owners.find((x) => !x.done && x.participantId)
    if (o) return o.ownerName
    if (!t.culture.done && t.culture.total > 0) return CULTURE_THEME
    return null
  }

  const fireRace = () => {
    races++; buzzArmedAt = Date.now()
    bots.forEach((b) => b.sock.emit(EVENTS.BUZZ, {})) // TOUS buzzent en même temps
  }

  // Pilotage réactif
  host.on(EVENTS.BUZZ_QUESTION_STARTED, async (p) => {
    if (p.buzz.phase === 'owner_oral') {
      await sleep(STEP_MS)
      host.emit(EVENTS.HOST_ADJUDICATE, { correct: false }) // l'owner "sèche" → on teste le vol
    } else if (p.buzz.phase === 'steal' && p.buzz.armed) {
      fireRace() // culture : buzzer ouvert d'emblée (armé dès le buzz_question_started)
    }
  })
  host.on(EVENTS.BUZZ_STATE, async (st) => {
    if (st.phase === 'steal' && st.armed && !st.lockedBy) {
      fireRace() // perso : buzzer ré-armé après l'échec de l'owner
    } else if (st.phase === 'locked' && st.lockedBy) {
      locks++
      latencies.push(Date.now() - buzzArmedAt)
      if (!bots.some((b) => b.id === st.lockedBy.participantId)) badWinner++
      await sleep(STEP_MS)
      host.emit(EVENTS.HOST_ADJUDICATE, { correct: true })
    }
  })
  host.on(EVENTS.BUZZ_QUESTION_ENDED, async (p) => {
    if (p.scorer) pointsAwarded += p.scorer.points
    if (CHURN > 0 && !churnStarted) {
      churnStarted = true
      bots.slice(0, CHURN).forEach((b) => { void reconnectBot(b) }) // déco/reco en pleine partie
    }
    await sleep(STEP_MS)
    host.emit(EVENTS.HOST_NEXT_QUESTION, {}) // question suivante dans le thème
  })
  host.on(EVENTS.BUZZ_THEMES, async (t) => {
    if (t.currentTheme === null) {
      const next = pickNext(t)
      await sleep(STEP_MS)
      if (next) host.emit(EVENTS.HOST_START_THEME, { ownerName: next })
      else host.emit(EVENTS.HOST_END_QUIZ, {})
    }
  })

  const donePromise = new Promise((resolve) => {
    host.on(EVENTS.SESSION_STATUS_CHANGED, (s) => { if (s.status === 'ended') resolve() })
  })

  // Démarrage
  host.emit(EVENTS.HOST_START_QUIZ, {})
  await sleep(STEP_MS)
  const first = pickNext(latestThemes)
  host.emit(EVENTS.HOST_START_THEME, { ownerName: first ?? CULTURE_THEME })

  const t0 = Date.now()
  await Promise.race([donePromise, sleep(120_000)])
  // Fenêtre de grâce : laisser arriver le leaderboard_update final (émis juste
  // après le statut 'ended') avant de figer le rapport côté clients.
  await sleep(400)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0

  // Cohérence des INFORMATIONS : chaque client doit avoir vu toutes les
  // révélations et le MÊME classement final que le serveur, et le total des
  // points distribués doit égaler la somme du classement (rien de perdu/dupliqué).
  const lbKey = (lb) =>
    lb ? [...lb].sort((a, b) => (a.participantId < b.participantId ? -1 : 1)).map((s) => `${s.participantId}:${s.score}`).join('|') : 'null'
  const hk = lbKey(hostFinalLb)
  const gotFinal = bots.filter((b) => b.finalLb).length
  const agree = bots.filter((b) => lbKey(b.finalLb) === hk).length
  // Les clients qui ont churné ont raté les révélations pendant leur coupure : on
  // ne leur applique PAS le check « toutes les révélations », mais bien le check
  // « classement final identique » (c'est ça, la reconnexion transparente).
  const stable = bots.filter((b) => !b.churned)
  const allReveals = stable.filter((b) => b.reveals === races).length
  const churnedCount = bots.filter((b) => b.churned).length
  const totalScore = hostFinalLb ? hostFinalLb.reduce((a, s) => a + s.score, 0) : 0
  const conserved = totalScore === pointsAwarded

  console.log('\n━━━ RÉSULTAT (buzzer) ━━━')
  console.log(`Bots               : ${N}`)
  console.log(`Courses au buzzer  : ${races}`)
  console.log(`Verrouillages      : ${locks}  (attendu = ${races})`)
  console.log(`Latence lock (ms)  : min ${Math.min(...latencies) || 0} · moy ${avg} · max ${Math.max(...latencies) || 0}`)
  console.log(`Gagnants invalides : ${badWinner}  (doit être 0)`)
  console.log(`Erreurs quiz_error : ${errors}  (doit être 0)`)
  console.log(`Durée partie       : ${elapsed}s`)
  console.log('━━━ INFORMATIONS (cohérence des N clients) ━━━')
  console.log(`Classement final reçu   : ${gotFinal}/${N} clients`)
  console.log(`Classement == serveur   : ${agree}/${N} clients`)
  console.log(`Révélations vues (${races}) : ${allReveals}/${stable.length} clients stables complets`)
  if (CHURN > 0) console.log(`Reconnexions en jeu     : ${churnedCount} clients (classement final vérifié ci-dessus)`)
  console.log(`Points distribués/total : ${pointsAwarded} / ${totalScore}  (${conserved ? 'conservé ✓' : 'ÉCART ✗'})`)
  const ok =
    locks === races && badWinner === 0 && errors === 0 &&
    gotFinal === N && agree === N && allReveals === stable.length && conserved
  console.log(ok ? '✅ OK — informations cohérentes pour tous' : '❌ ANOMALIE détectée')

  ;[host, ...bots.map((b) => b.sock)].forEach((s) => s.disconnect())
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
