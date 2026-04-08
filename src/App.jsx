import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:3000');
const HORSE_COLORS = ['#ff4757','#3742fa','#2ed573','#ffa502','#8e44ad','#ff6348','#1e90ff','#2f3542','#ff6b81','#7bed9f'];

function App() {
  const [isJoined, setIsJoined] = useState(false);
  const [myInfo, setMyInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [gameState, setGameState] = useState('lobby');
  const [gameData, setGameData] = useState([]);
  const [timer, setTimer] = useState(0);
  const [myBet, setMyBet] = useState(null); // { choice, amount } or null
  const [betAmount, setBetAmount] = useState('');
  const [eventAlert, setEventAlert] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [racingBetCounts, setRacingBetCounts] = useState({});
  const [finalRanking, setFinalRanking] = useState(null);
  const [messages, setMessages] = useState([]);
  const [nickname, setNickname] = useState('');
  const [staffCode, setStaffCode] = useState('');
  const [profilePic, setProfilePic] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editNick, setEditNick] = useState('');
  const [editPic, setEditPic] = useState('');
  const [chatFrozen, setChatFrozen] = useState(false);
  const [bettingTimer, setBettingTimer] = useState('40');
  const [racingTimer, setRacingTimer] = useState('60');
  const chatEndRef = useRef(null);
  const alertTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const editFileRef = useRef(null);

  const showAlertTimed = useCallback((data, duration = 10000) => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    setEventAlert(data);
    alertTimerRef.current = setTimeout(() => setEventAlert(null), duration);
  }, []);

  const handleFileToBase64 = (file, cb) => {
    if (!file) return;
    if (file.size > 500000) return alert('500KB 이하 이미지만 가능합니다.');
    const reader = new FileReader();
    reader.onload = () => cb(reader.result);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    socket.on('joinSuccess', (info) => {
      setMyInfo(info); setIsJoined(true);
      localStorage.setItem('lucky_user', JSON.stringify({ nickname: info.nickname, profilePic: info.profilePic, isStaff: info.isStaff }));
    });
    socket.on('profileUpdated', (info) => {
      setMyInfo(prev => ({ ...prev, ...info }));
      const saved = JSON.parse(localStorage.getItem('lucky_user') || '{}');
      localStorage.setItem('lucky_user', JSON.stringify({ ...saved, nickname: info.nickname, profilePic: info.profilePic }));
    });
    socket.on('updateUsers', (list) => {
      const sorted = [...list].sort((a, b) => b.balance - a.balance);
      setUsers(sorted);
      const me = list.find(u => u.id === socket.id);
      if (me) setMyInfo(me);
    });
    socket.on('gameStarted', (state) => {
      setGameState(state.phase); setGameData(state.data); setTimer(state.timer);
      setMyBet(null); setEventAlert(null); setSelectedChoice(null); setBetAmount('');
      setRacingBetCounts({}); setFinalRanking(null);
    });
    socket.on('timerUpdate', (t) => setTimer(t));
    socket.on('racingBetCounts', (c) => setRacingBetCounts(c));
    socket.on('betConfirmed', (d) => setMyBet(d));
    socket.on('receiveMessage', (m) => setMessages(prev => [...prev.slice(-100), m]));

    socket.on('bettingResults', (d) => {
      setGameState('lobby');
      const myWin = d.payouts?.[socket.id] || 0;
      const myResult = d.userResults?.[socket.id] || null;
      showAlertTimed({ ...d, type: 'betting', myWin, myResult }, 15000);
    });
    socket.on('racingResults', (d) => {
      setGameState('lobby');
      const myWin = d.payouts?.[socket.id] || 0;
      showAlertTimed({ ...d, type: 'racing', myWin }, 12000);
    });
    socket.on('resurrectionEvent', (d) => showAlertTimed({ type: 'resurrection', count: d.count }, 5000));
    socket.on('fateEvent', (d) => showAlertTimed({ type: 'fate', ...d }, 12000));
    socket.on('gameEnded', (d) => { setFinalRanking(d.ranking); setEventAlert(null); });
    socket.on('gameReset', () => { setFinalRanking(null); setEventAlert(null); setGameState('lobby'); });
    socket.on('chatFreezeUpdate', (frozen) => setChatFrozen(frozen));

    const savedRaw = localStorage.getItem('lucky_user');
    if (savedRaw) {
      try {
        const saved = JSON.parse(savedRaw);
        if (saved.nickname) {
          socket.emit('joinGame', {
            nickname: saved.nickname,
            profilePic: saved.profilePic || '',
            isStaff: saved.isStaff || false
          });
        }
      } catch(e) { localStorage.removeItem('lucky_user'); }
    }

    return () => {
      ['joinSuccess','profileUpdated','updateUsers','gameStarted','timerUpdate',
       'racingBetCounts','betConfirmed','receiveMessage','bettingResults','racingResults',
       'resurrectionEvent','fateEvent','gameEnded','gameReset','chatFreezeUpdate'].forEach(e => socket.off(e));
    };
  }, [showAlertTimed]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // 배팅액 변경 시 서버에 임시 저장 (자동 확정용)
  useEffect(() => {
    if (gameState !== 'lobby' && betAmount) {
      socket.emit('updateBetAmount', parseInt(betAmount) || 0);
    }
  }, [betAmount, gameState]);

  const handleJoin = () => {
    if (!nickname.trim()) return alert('닉네임을 입력하세요!');
    if (!profilePic) return alert('프로필 사진을 등록하세요!');
    socket.emit('joinGame', { nickname: nickname.trim(), secretCode: staffCode, profilePic });
  };

  const handleSelect = (idx) => {
    if (myInfo.isBeggar) return;
    setSelectedChoice(idx);
    socket.emit('selectChoice', idx);
  };

  const submitBet = () => {
    const amt = parseInt(betAmount);
    if (selectedChoice === null) return alert('선택지를 골라주세요!');
    if (!amt || amt <= 0) return alert('배팅 금액을 입력하세요!');
    if (amt > myInfo.balance) return alert('잔액이 부족합니다!');
    socket.emit('submitBet', { choice: selectedChoice, amount: amt });
    // myBet은 betConfirmed 이벤트에서 설정됨
  };

  const handleChangeBet = () => {
    // 재선택 모드로 전환
    setMyBet(null);
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    const input = e.target.elements.m;
    if (!input.value.trim()) return;
    socket.emit('sendMessage', input.value);
    input.value = '';
  };

  const openProfileEdit = () => { setEditNick(myInfo.nickname); setEditPic(myInfo.profilePic); setShowProfileModal(true); };
  const saveProfile = () => {
    if (!editNick.trim()) return alert('닉네임을 입력하세요!');
    socket.emit('updateProfile', { nickname: editNick.trim(), profilePic: editPic });
    const saved = JSON.parse(localStorage.getItem('lucky_user') || '{}');
    localStorage.setItem('lucky_user', JSON.stringify({ ...saved, nickname: editNick.trim(), profilePic: editPic }));
    setShowProfileModal(false);
  };

  // ===== 입장 화면 =====
  if (!isJoined) {
    return (
      <div className="join-container">
        <h1>🎰 럭키아일랜드</h1>
        <div className="join-pic-area" onClick={() => fileInputRef.current?.click()}>
          {profilePic ? <img src={profilePic} className="join-pic-preview" alt="" /> : <div className="join-pic-placeholder">📷<br/>프로필 사진</div>}
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={e => handleFileToBase64(e.target.files[0], setProfilePic)} />
        </div>
        <input placeholder="닉네임" value={nickname} onChange={e => setNickname(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleJoin()} />
        <input placeholder="스탭코드 (선택)" type="password" value={staffCode} onChange={e => setStaffCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleJoin()} />
        <button onClick={handleJoin}>입장하기</button>
      </div>
    );
  }

  const isInGame = gameState !== 'lobby';

  return (
    <div className="game-wrapper">
      {/* 프로필 수정 모달 */}
      {showProfileModal && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>프로필 수정</h3>
            <div className="modal-pic-area" onClick={() => editFileRef.current?.click()}>
              <img src={editPic} className="big-pic" alt="" />
              <div className="modal-pic-hint">클릭하여 변경</div>
              <input ref={editFileRef} type="file" accept="image/*" hidden onChange={e => handleFileToBase64(e.target.files[0], setEditPic)} />
            </div>
            <input value={editNick} onChange={e => setEditNick(e.target.value)} placeholder="닉네임" />
            <div className="modal-btns">
              <button className="modal-cancel" onClick={() => setShowProfileModal(false)}>취소</button>
              <button className="modal-save" onClick={saveProfile}>저장</button>
            </div>
          </div>
        </div>
      )}

      <header className="game-header">
        <div className="user-profile-bar" onClick={openProfileEdit} style={{ cursor: 'pointer' }}>
          <img src={myInfo.profilePic} className="mini-pic" alt="" />
          <div className="meta">
            <div className="nick">
              {myInfo.nickname}
              {myInfo.isBeggar && <span className="b-badge">거지😭</span>}
              {myInfo.isStaff && <span className="staff-badge">STAFF</span>}
            </div>
            <div className="bal">{myInfo.balance.toLocaleString()}원</div>
          </div>
        </div>
        <div className="header-right">
          <span className="player-count">👥 {users.length}명</span>
          <button className="logout-btn" onClick={() => { localStorage.removeItem('lucky_user'); window.location.reload(); }}>로그아웃</button>
        </div>
      </header>

      <div className="game-main">
        {/* 랭킹 */}
        <aside className="ranking-area card">
          <h3>🏆 랭킹</h3>
          <div className="rank-list">
            {users.map((u, i) => (
              <div key={u.id} className={`rank-row ${u.isBeggar ? 'is-beggar' : ''} ${u.id === socket.id ? 'is-me-rank' : ''}`}>
                <span className="num">{i + 1}</span>
                <img src={u.profilePic} className="mini-pic" alt="" />
                <div className="info">
                  <div className="name">{u.nickname} {u.isBeggar && <span className="beggar-tag">거지</span>}</div>
                  <div className="money">{u.balance.toLocaleString()}원</div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* 메인 */}
        <main className="game-stage">
          {/* 결과 오버레이 */}
          {eventAlert && (
            <div className="stage-overlay" onClick={() => setEventAlert(null)}>
              <div className="alert-card card" onClick={e => e.stopPropagation()}>
                {eventAlert.type === 'betting' && (
                  <>
                    <h2>🎲 배팅 게임 결과</h2>
                    {eventAlert.revealMap && (
                      <div className="reveal-grid">
                        {Object.entries(eventAlert.revealMap).map(([idx, info]) => (
                          <div key={idx} className="reveal-item">
                            <span className="reveal-num">{parseInt(idx)+1}번</span>
                            <span className="reveal-label">{info.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {eventAlert.myResult ? (
                      <div className="my-result-box">
                        <div className="my-result-label">내 선택: {eventAlert.myResult.choice + 1}번 → <strong>{eventAlert.myResult.effect}</strong></div>
                        <div className={`personal-win ${eventAlert.myWin >= 0 ? 'plus' : 'minus'}`}>
                          {eventAlert.myWin > 0 ? '+' : ''}{eventAlert.myWin.toLocaleString()}원
                        </div>
                      </div>
                    ) : (
                      <div className="my-result-box"><div className="my-result-label">미배팅</div></div>
                    )}
                    {eventAlert.jackpotUser && (
                      <div className="special-event">
                        <h3>🎉 잭팟!</h3>
                        <img src={eventAlert.jackpotUser.profilePic} className="event-big-pic" alt="" />
                        <p><strong>{eventAlert.jackpotUser.nickname}</strong> +{eventAlert.jackpotUser.bonus?.toLocaleString()}원 보너스!</p>
                      </div>
                    )}
                    {eventAlert.swapEvent && (
                      <div className="special-event">
                        <h3>😱 왕자와 거지!</h3>
                        <div className="swap-users">
                          <div className="swap-user"><img src={eventAlert.swapEvent.poor.profilePic} className="event-big-pic" alt="" /><p>{eventAlert.swapEvent.poor.nickname}</p></div>
                          <span className="swap-arrow">⇄</span>
                          <div className="swap-user"><img src={eventAlert.swapEvent.rich.profilePic} className="event-big-pic" alt="" /><p>{eventAlert.swapEvent.rich.nickname}</p></div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {eventAlert.type === 'racing' && (
                  <>
                    <h2>🏇 경마 결과</h2>
                    <div className="horse-winner" style={{ background: HORSE_COLORS[eventAlert.winIndex] }}>{eventAlert.winIndex + 1}번 말 우승!</div>
                    <div className={`personal-win ${(eventAlert.myWin||0) >= 0 ? 'plus' : 'minus'}`}>
                      내 수익: {(eventAlert.myWin||0) > 0 ? '+' : ''}{(eventAlert.myWin||0).toLocaleString()}원
                    </div>
                    {eventAlert.surprise && (
                      <div className="special-event surprise-event">
                        <h3>🎉 깜짝 이벤트!</h3>
                        <p className="surprise-desc">아무도 1등 말에 배팅하지 않아<br/>최하위에게 전체 상금이 돌아갑니다!</p>
                        <img src={eventAlert.surprise.profilePic} className="event-big-pic" alt="" />
                        <p className="surprise-name"><strong>{eventAlert.surprise.nickname}</strong></p>
                        <p className="surprise-amount plus">+{eventAlert.surprise.pool?.toLocaleString()}원 독식!</p>
                      </div>
                    )}
                    {eventAlert.winnerCount === 0 && !eventAlert.surprise && eventAlert.pool === 0 && (
                      <p>아무도 배팅하지 않았습니다.</p>
                    )}
                  </>
                )}

                {eventAlert.type === 'fate' && (
                  <>
                    <h2>🎲 운명 이벤트</h2>
                    <p className="fate-msg">{eventAlert.msg}</p>
                    <div className="fate-list">
                      {eventAlert.topUsers?.map(u => (
                        <div key={u.id} className="fate-user-row">
                          <img src={u.profilePic} className="mini-pic" alt="" />
                          <span>{u.nickname}</span>
                          <span className={u.change > 0 ? 'plus' : 'minus'}>{u.change > 0 ? '+' : ''}{u.change.toLocaleString()}원</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {eventAlert.type === 'resurrection' && (
                  <><h2>👼 거지 회생</h2><p className="resurrection-msg">{eventAlert.count}명이 1,000원으로 부활!</p></>
                )}
                <button className="close-alert-btn" onClick={() => setEventAlert(null)}>닫기</button>
              </div>
            </div>
          )}

          {/* 최종 랭킹 */}
          {finalRanking && (
            <div className="stage-overlay gold-bg">
              <div className="end-content">
                <h1 className="gold-title">🏆 FINAL RANKING</h1>
                {finalRanking[0] && (
                  <div className="winner-1st">
                    <img src={finalRanking[0].profilePic} className="final-1st-pic" alt="" />
                    <h2>{finalRanking[0].nickname}</h2>
                    <p className="winner-balance">{finalRanking[0].balance.toLocaleString()}원</p>
                  </div>
                )}
                <div className="winner-subs">
                  {finalRanking.slice(1, 4).map((u, i) => (
                    <div key={u.id} className="sub-rank">
                      <span className="sub-rank-num">{i + 2}위</span>
                      <img src={u.profilePic} className="mini-pic" alt="" />
                      <span>{u.nickname}</span>
                      <span className="sub-bal">{u.balance.toLocaleString()}원</span>
                    </div>
                  ))}
                </div>
                {myInfo.isStaff && (
                  <button className="reset-btn" onClick={() => socket.emit('resetGame')}>새 게임 (잔액 초기화)</button>
                )}
              </div>
            </div>
          )}

          {/* 스탭 패널 */}
          {myInfo.isStaff && (
            <div className="staff-panel">
              <div className="staff-row">
                <div className="staff-timer-group">
                  <input type="number" value={bettingTimer} onChange={e => setBettingTimer(e.target.value)} className="staff-timer-input" min="10" max="300" />
                  <button onClick={() => socket.emit('startBettingGame', { timer: parseInt(bettingTimer) || 40 })} className="s-btn s1">배팅시작</button>
                </div>
                <div className="staff-timer-group">
                  <input type="number" value={racingTimer} onChange={e => setRacingTimer(e.target.value)} className="staff-timer-input" min="10" max="300" />
                  <button onClick={() => socket.emit('startHorseRacing', { timer: parseInt(racingTimer) || 60 })} className="s-btn s2">경마시작</button>
                </div>
                <button onClick={() => socket.emit('resurrectBeggars')} className="s-btn s3">거지회생</button>
                <button onClick={() => socket.emit('triggerFateEvent')} className="s-btn s4">운명뽑기</button>
                <button onClick={() => socket.emit('toggleChatFreeze')} className={`s-btn ${chatFrozen ? 's-freeze-on' : 's-freeze'}`}>{chatFrozen ? '🔓채팅녹이기' : '🔒채팅얼리기'}</button>
                <button onClick={() => socket.emit('endGame')} className="s-btn s-end">최종발표</button>
              </div>
            </div>
          )}

          <div className="stage-content card">
            {isInGame ? (
              <div className="bet-board">
                <div className="timer-display">
                  <span className={`timer ${timer <= 10 ? 'timer-urgent' : ''}`}>{timer}s</span>
                </div>

                {myInfo.isBeggar && <div className="beggar-msg">😭 거지는 배팅 불가</div>}

                {!myInfo.isBeggar && (
                  <div className="bet-input-box">
                    <label>배팅액:</label>
                    <input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} placeholder="금액" min="1" max={myInfo.balance} />
                    <span className="bal-hint">잔액 {myInfo.balance.toLocaleString()}원</span>
                  </div>
                )}

                {myBet && (
                  <div className="bet-confirmed-msg">
                    ✅ {gameData[myBet.choice]}에 {myBet.amount.toLocaleString()}원 배팅 완료
                    <button className="change-bet-btn" onClick={handleChangeBet}>변경하기</button>
                  </div>
                )}

                <div className={gameState === 'betting' ? 'grid-betting' : 'grid-racing'}>
                  {gameData.map((name, i) => (
                    <button key={i}
                      onClick={() => handleSelect(i)}
                      className={`opt-btn ${selectedChoice === i ? 'is-active' : ''} ${myBet?.choice === i ? 'is-confirmed' : ''}`}
                      disabled={myInfo.isBeggar}
                      style={gameState === 'racing' ? { borderTop: `4px solid ${HORSE_COLORS[i]}` } : {}}
                    >
                      <div className="opt-name">
                        {gameState === 'racing' && <span className="horse-dot" style={{ color: HORSE_COLORS[i] }}>●</span>}
                        {name}
                      </div>
                      {/* 경마: 확정 배팅 수만 표시 */}
                      {gameState === 'racing' && (
                        <div className="c-row">🔥 {racingBetCounts[i] || 0}명</div>
                      )}
                    </button>
                  ))}
                </div>

                {!myInfo.isBeggar && selectedChoice !== null && !myBet && (
                  <button className="confirm-btn" onClick={submitBet}>배팅 확정</button>
                )}

                {!myInfo.isBeggar && !myBet && (
                  <p className="auto-hint">⏱ 시간 종료 시 현재 선택과 금액으로 자동 확정됩니다</p>
                )}
              </div>
            ) : (
              <div className="lobby-msg"><div className="lobby-icon">🏝️</div><p>스탭이 게임을 시작할 때까지 기다려주세요.</p></div>
            )}
          </div>
        </main>

        {/* 채팅 */}
        <aside className="chat-aside card">
          <h3>💬 채팅</h3>
          <div className="chat-box">
            {messages.map(m => (
              <div key={m.id} className={`chat-line ${m.senderId === socket.id ? 'is-me' : ''} ${m.isStaff ? 'is-staff-msg' : ''}`}>
                <img src={m.profilePic} className="mini-pic" alt="" />
                <div className={`bubble ${m.isStaff ? 'staff-bubble' : ''}`}>
                  <div className="chat-nick">
                    {m.isStaff && <span className="chat-staff-badge">STAFF</span>}
                    {m.nickname}
                    {m.isBeggar && <span className="beggar-tag">거지</span>}
                  </div>
                  <div className="txt">{m.text}</div>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-form" onSubmit={handleChatSubmit}>
            {chatFrozen && !myInfo?.isStaff ? (
              <div className="chat-frozen-msg">🧊 채팅창이 얼었어요</div>
            ) : (
              <>
                <input name="m" placeholder={chatFrozen ? "채팅 얼림 중 (스탭만 가능)" : "채팅 입력..."} autoComplete="off" />
                <button type="submit">전송</button>
              </>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}

export default App;
