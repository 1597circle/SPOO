window.__NAVER_AUTH_FAILED = false;
  window.navermap_authFailure = function(){
    window.__NAVER_AUTH_FAILED = true;
    const box = document.getElementById('map');
    if(box){
      box.innerHTML = `
        <div style="height:100%;display:flex;align-items:center;justify-content:center;padding:24px;">
          <div style="max-width:440px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.08);font-family:'Pretendard',sans-serif;">
            <div style="font-size:32px;margin-bottom:8px;">🗺️</div>
            <h3 style="margin:0 0 10px;color:#F04452;font-size:18px;">지도를 불러오지 못했어요</h3>
            <p style="font-size:var(--fs-body);line-height:1.6;color:#4E5968;">
              네이버클라우드에 등록한 주소랑 지금 이 페이지 주소가 달라서 그래요.<br><br>
              지금 주소: <code style="background:#F2F4F6;padding:2px 6px;border-radius:4px;">${location.origin}</code><br><br>
              네이버클라우드 콘솔에서 이 주소가 정확히 등록되어 있는지 확인해주세요.
            </p>
          </div>
        </div>`;
    }
  };
