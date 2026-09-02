// Toguz Korgool game rules — pure logic, no rendering.
// pits[0..8]  = Player 1 row
// pits[9..17] = Player 2 row
// sowing order: 0 -> 1 -> ... -> 17 -> 0

export const TOTAL_STONES = 180;

export function createGame(){
  return {
    pits: new Array(18).fill(10),
    kazan: [0, 0],
    tuzduk: [-1, -1],
    current: 1,
    moveCount: 0,
    gameOver: false,
  };
}

export const ownerOf = idx => idx <= 8 ? 0 : 1;
export const nextIdx = idx => (idx + 1) % 18;

export function legalMoves(state, player){
  const range = player === 0 ? [0, 8] : [9, 17];
  const moves = [];
  for(let i = range[0]; i <= range[1]; i++){
    // Can pick up if 1+ stones, but NOT if it's opponent's tuzduk
    if(state.pits[i] > 0){
      const opponent = 1 - player;
      const isOpponentTuzduk = (opponent === 0 && state.tuzduk[0] === i) || (opponent === 1 && state.tuzduk[1] === i);
      if(!isOpponentTuzduk) moves.push(i);
    }
  }
  return moves;
}

/**
 * Play a move from `startIdx`. Mutates `state` in place and returns a
 * result describing what happened, so the caller can animate it.
 */
export function playMove(state, startIdx){
  const { pits, kazan, tuzduk } = state;
  const player = state.current;
  const opponent = 1 - player;

  let stones = pits[startIdx];
  pits[startIdx] = 1;  // Always leave 1 stone in source pit
  stones = stones - 1;  // Sow only N-1 stones
  let pos = startIdx;
  const steps = [];

  // Sow stones
  for(let s = 0; s < stones; s++){
    pos = nextIdx(pos);
    const holeOwnerTuzduk = tuzduk[0] === pos ? 0 : (tuzduk[1] === pos ? 1 : -1);
    if(holeOwnerTuzduk !== -1){
      kazan[holeOwnerTuzduk] += 1;
      steps.push({ pit: pos, toKazan: holeOwnerTuzduk });
    } else {
      pits[pos] += 1;
      steps.push({ pit: pos, toKazan: -1 });
    }
  }
  
  const lastPos = pos;
  const lastWasTuzduk = tuzduk[0] === lastPos || tuzduk[1] === lastPos;
  let captureInfo = null;

  if(!lastWasTuzduk && ownerOf(lastPos) === opponent){
    const count = pits[lastPos];
    if(count > 0 && count % 2 === 0){
      kazan[player] += count - 1;  // Leave 1 stone
      pits[lastPos] = 1;
      captureInfo = { type: 'capture', pit: lastPos, amount: count - 1 };
    } else if(count === 3 && tuzduk[player] === -1 && state.moveCount > 0){
      const forbidden = player === 0 ? 17 : 8;
      if(lastPos !== forbidden){
        tuzduk[player] = lastPos;
        kazan[player] += 3;  // Take ALL 3 stones
        pits[lastPos] = 0;  // Tuzduk is a hole - 0 stones
        captureInfo = { type: 'tuzduk', pit: lastPos, amount: 3 };
      }
    }
  }

  state.moveCount++;

  let ended = false;
  let endReason = '';
  if(legalMoves(state, opponent).length === 0){
    const remainingOwner = legalMoves(state, player).length > 0 ? player : -1;
    if(remainingOwner !== -1){
      for(let i = 0; i < 18; i++){
        if(ownerOf(i) === remainingOwner){
          kazan[remainingOwner] += pits[i];
          pits[i] = 0;
        }
      }
    }
    ended = true;
  }
  if(kazan[player] >= 82) ended = true;
  if(kazan[0] + kazan[1] === TOTAL_STONES && !ended) ended = true;

  if(ended){
    state.gameOver = true;
    if(kazan[0] > kazan[1]) endReason = 'p1';
    else if(kazan[1] > kazan[0]) endReason = 'p2';
    else endReason = 'draw';
  } else {
    state.current = opponent;
  }

  return { steps, captureInfo, lastPos, ended, endReason, player };
}
