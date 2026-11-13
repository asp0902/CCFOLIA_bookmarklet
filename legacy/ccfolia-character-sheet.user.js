// ==UserScript==
// @name         CCFOLIA Saikoro Fiction Character Sheet by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-character-sheet
// @version      0.5.34
// @description  Detect inSANe rooms and add room-local character sheets with BCDice commands.
// @description:ko 사이코로픽션 룸을 감지해 룸별 캐릭터 시트와 BCDice 판정 입력 기능을 추가합니다. 현재 인세인을 지원합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const FEATURE_ID = "ccf-character-sheet";
  const DEBUG_KEY = "__CCF_CHARACTER_SHEET_DEBUG__";
  const ROOT_ID = "ccf-character-sheet-root";
  const STYLE_ID = "ccf-character-sheet-style";
  const ICON_ATTR = "data-ccf-character-sheet-icon";
  const DIALOG_BUTTON_ATTR = "data-ccf-character-sheet-dialog-button";
  const ROW_BUTTON_ATTR = "data-ccf-character-sheet-row-button";
  const VERSION = "0.5.34";
  const TRANSFER_KIND = "capybara.insane-sheet";
  const TRANSFER_VERSION = 1;
  const MAX_TRANSFER_BYTES = 500_000;
  const CATEGORIES = Object.freeze([
    ["폭력", "소각", "고문", "포박", "협박", "파괴", "구타", "절단", "찌르기", "사격", "전쟁", "매장"],
    ["정서", "연심", "기쁨", "걱정", "부끄러움", "웃음", "인내", "놀람", "노여움", "원한", "슬픔", "친애"],
    ["지각", "고통", "관능", "촉감", "냄새", "맛", "소리", "풍경", "추적", "예술", "제육감", "그늘"],
    ["기술", "분해", "전자기기", "정리", "약품", "효율", "미디어", "카메라", "탈것", "기계", "함정", "병기"],
    ["지식", "물리학", "수학", "화학", "생물학", "의학", "교양", "인류학", "역사", "민속학", "고고학", "천문학"],
    ["괴이", "시간", "혼돈", "심해", "죽음", "영혼", "마술", "암흑", "종말", "꿈", "지저", "우주"]
  ]);
  const TABLE_COMMANDS = Object.freeze([
    ["장면표", "ST"], ["감정표", "FT"], ["엔딩표", "BET"]
  ]);
  const SKILL_TABLE_COMMANDS = Object.freeze([
    ["랜덤", "RTT"], ["폭력", "TVT"], ["정서", "TET"], ["지각", "TPT"],
    ["기술", "TST"], ["지식", "TKT"], ["괴이", "TMT"]
  ]);

  // 판정 아이콘: Roll20 의 글꼴 dicefontd20 의 글자 "t"(Roll20 시트의 롤 버튼 아이콘, 17px). 글꼴 파일은 Roll20 base.css 에 data URI 로 들어 있던 woff 를 추출한 것(개인 사용, 출처: Roll20 dicefontd20).
  // 확장·북마클릿이 같은 아이콘을 쓰도록 data URI 로 넣는다. 글꼴이 안 불러지면 아래 SVG 로 대신 그린다.
  // dicefontd20 — Roll20, 개인 사용 (Roll20 base.css 의 글꼴을 base64 로 포함)
  const D20_FONT_FAMILY = "ccf-dicefontd20";
  const D20_FONT_BASE64 = "d09GRgABAAAAADV8AA8AAAAAfswAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABGRlRNAAABWAAAABwAAAAcZshnhUdERUYAAAF0AAAAHQAAACAAXAAET1MvMgAAAZQAAABKAAAAYHTsWKBjbWFwAAAB4AAAAIsAAAFy/Aj/nWN2dCAAAAJsAAAABAAAAAQARAURZ2FzcAAAAnAAAAAIAAAACAAAABBnbHlmAAACeAAAL/QAAHZ4W6szYWhlYWQAADJsAAAALgAAADYAYWa3aGhlYQAAMpwAAAAdAAAAJA3XCAhobXR4AAAyvAAAACcAAAC8N9QRQmxvY2EAADLkAAAAYAAAAGCBFZGWbWF4cAAAM0QAAAAgAAAAIAERFFpuYW1lAAAzZAAAAZUAAAMD+WL0cnBvc3QAADT8AAAAeAAAAJfHfesMd2ViZgAANXQAAAAGAAAABtylUR8AAAABAAAAAMw9os8AAAAAzUU3kwAAAADNRY0ieNpjYGRgYOADYgkGEGBiYARCPSBmAfMYAAZEAGEAAAB42mNgZlvPOIGBlYGF1ZjlDAMDw0wIzXSGwYhRB8gHSsEBIwMSCPUO92NwYOB9wMCW9i+NgYHdkEEDpobdkF0eSCkwMAIALaAKUQAAeNpjYGBgZoBgGQZGBhDIAfIYwXwWhgAgLQCEzGAZXgYFBgOGEIaSBwz//yOJODAkgkUY/3/9//j/lf9H/+9U0IOahgIY2RjgwoxMQIIJXQED1CoEYEHjs7Kxc3BycfPw8vELCAoJi4iKiUtIIiuQkpaRlZNXUFRSVlFVU9fQ1NLW0WUYPAAAKioWkQAARAURAAEAAf//AA942r19CZQkV3Vl/jX2JSMzMrKyKmvJqMysru6ubuUqqfdWq7W2QBISkiwkIYQkQAv7YjZbYMQxnhkWs4kBZBsvmAEbxp7Bg7E59ox9bA+LfTybj42P8Xg5xxszHLAHqpK570dWq1utEkhNqqo6qzIzIv777753330/IqNLvHSiVOJ3qRtKomSVNj7NSvsOfsaSpX/ofVqrPz34GcHxZ+nTgl5W9PJnLM02D36G0ev98kq5vVJeOcGXJ6vsA5N71Q3f/sQJ+cVSqeSV7iqV9MesC0pxqVZqlvJSt7RR6pfGpYtLR0uXlkoOazGdljMmD7ARGw3LrGypocPydgt/t62SxdrKYYqtjMbJmAUsL/dZm/UdtqLaNdZebbOcKf3o5l97W15Lsq+zVZvv5b+7vvklvnUT/wX+Fbb1PM1/cav1nsnfW5Ov8i+J2uSrk+v4lyZf2Hz0R/JJmX1q897J1zlX/3fydRbyLT15jrjpOy9lvs8emnx28mvq81v3cvYTLFT3sN+fnHTrmw8nk7/4RMY+HNfEm9nHJr/Ie5y9ffLqnmTPmbzW/e6kKflnBoOta/hfD7ZGX7uQfaG6VfXfItzNb72FP/ydAd/98I86E/35z+nJQ1z8aOnR0rdLn9KhPmC/yL7fcZwF52HnHe7/cLe8jnfCu9y7xvu03/L3+hf4I/8S/xb/lf57/Uf8j/g/5/+z/91gGBwMjgfXB3cG9wb3B68N3hr86+D9wUeDnw8+EXw6+FzwO8EXgz8O/mfwZ8FfB38XviT88fCd4fvCR8O/Cf8+KkdZNB/dHt0VvTh6afSu6NHoF6JPRb8R/X70x9GfRP875rGOgziJl+PL4lPxdfEPxffED8avjt8Q/1k5A+jd8u7yvvKh8rHyJeWryteV31/+UPmj5Y+VP17+9+VfL/9e+YvlP05Y4ifNJE+6yZ5kkBxKjiUnkiuTZyXXJzcmtyUvTB5MXpH8cPLm5KHk4eTfJO9NHkk+mvx08vHkl5PPJl9Ifif5r8kfJv8t+WryteQfk28m/68iKm6lUXlf5SOV36j858rvVf6q8neVb1W+XZXVtVKJpZmVZnmWVq0szbu5eezkaZZaaa2f9vOs12SZleENizbFm92sN8z6A2zVOcTGw0HX6lp5a9jCk3w87Pa75iFvMuyCPaq5trSVD8bd4Tiv5hGCt9pPtZWN8ZAfCkbj0RgHwD8cYbCbWWZs7IhvbNA9wvLxIdbtjbutqQ102D7ezXDoHG9hMHqJZoFHzCQloyNWzfrjLO2bHaa/iv1TbGmZH5iGY6RW3zzHTMbd/qDfhUX0nVtVGI4Za9rQ6vbHre4wT6vbLsMBa9gx7447OabCc3PQbVdl2hpqKx1nfQyod7NOTmNhDDwOrfQA01PPDq3d2BRTteD3A3oMq3vDPoynfYc97I+Z9MYHWO0A643pjaYmz6TZGN/9AqBigrX+eNhL+0Nydnc4Gg4OcDIJVvRhLc0WrhvXstoSH/fGI4ySYwjCbB+jBz6Erzvd/jAb15o6MyCmmGQNYxQuK1y9PcXcOIKeA64+bWuORxEAN06DYTz97sPaGu3VN88xOLw3RixEFIUtC4Fhwew+uROmd/MWEIBX+hY8BRsya9hqUnzkHWCSW50hIdayzHbdFlAbDXv4pnmN4K5qHw4bjGHIeNTvkEdgTG+cD3NNwdUlLEZwWE6OSVspxtJp1wCX0SuYQoatUvi/b0KullFoDPtWlfwOJIY9QmDcQyybV3qYXy2lSRKwVRyXDtZKO4AWg+cIYuxP1iIpKAzy6m42JGOKsK3mtTRPaylBhAShWMgG43Q07hEqmEmGZBlhct1BNj5k0XDVrNYf0budYWe4j+GxO0DOUGSS12A6YmI0xiExdF9btfQIw/EIAUQ0+aQ7GA+Ry0j+FqzF6Dm53thO4Z8jLbs4NnmvlcL1I9gxOMJHtNdwTHGbW4MuZS3mRJSADcf0TndI8Buvn/HTh4syyrm0yJRqRlOG86oZBQIgG2dVPBhfIlAZ7UUzp/BpKkNNQC6ztlPaxDUdrGvRmCOwEE2vQ5lmpSCNHrZpWTjmyByDHgbdQY4tsx48H7F8A6QEDOEp2Nwbm9Sj5KONRwNy0AAxhGed7iHRbQ2LoB52R8iTzGAzOoJIG+H9McDoFsSYF87NgBdAmmZJQV6nE8gwifndf9xv0BtMH2dkNJGmBhnBQdNsy4v5099wEgU65gdrekcMRSALDzFEb05G5KfdlE4f0l7ao0ga0jdM7JONh7iZE4FWfA/JiSD6IbgbW9NjPzV0QXv08MIQcT0cmIjOx0UwFdQzPqSKMkBAkDO6BQ2Y9Eb1oBgGSARrhmxCZmnjEQAGqFJjZIaEOcL6FOJ9Awl5IrVQPJBaSEbQHEAcILPpkOR6oMOmBvTBLj3ipLxmmIhgMejToQxJDE1OmuplLEY29ynwRsS48M4BluHfeLhbk49AE61uCsZBooBFEVxwV0YlgmLd0BTFWzokNgJ/IUyIWPopGKsHOHbDMEx3iDppiLJlksvUPap/LaozFEjIQRAGRiH3mVJITFKjVKmRm9IiYMj27cyiX/Bxl0wrMBjn20nX3wZyuA0HpUbW6YKyhsSfw4Khh/mU1VHfh5hBq2sIhbJkPKDZ9of5EqtNub8oAxSpqYmtfDuc+9tBXUR6emZEF3ViukmXShHYE3PUXSA4NimD5MU8jMGmKA3H3bO+EdJpf7gdnMVsirmdUZD6h1SuKB/7TTePOJEcMd4wH2IOVMZ1xOnY04MWXuyf+YSitQjkrhmteHLIMWblCoxMCcdr5BCTfCQzzpw9WUGPIPcWsQV2z4p4yy0qYH36qcIr1X6V6LDQHya0llAKEX09w0wpIoHEEt4DHlYHhyNW0Pm+QlshgoaAaUT5RwIDYIKoQNJgfjzvmlDNjOZoAUqkjN7NYRCpLJN2ra4ps6RkADqiVmF3U0GQF1XSeobpDOcT0YnxaJv6zE8nx+uUy/2ipudppzslkeEUxTHxS5dG7KJKIJwO8/FjYUQslzVZsd3U5+RrkZMgaHLUhSH5owZWoNivEttSdcppa6DfUaQKtVF6mBFVDwg25Cpldt5R8JwiordUkxlU+ohjE5HTCJ3SsilwBH8+3FYsw7zIjP52AKTbU8IzhVmZmJ4KIprLlMzpVXP8aVBua02r8Er3kCoOB4Y4xB8LZpImNNg0sk0JpSdZTkGQUZFXsNPUQzVEKiJDjYXdFLKvCmokTTTsFmJoMDaKjEyB33czI5oOcZDiUGVQc1QaSRzAcUNQ+SFOMhdDACKVkaAGb6qc/DocKIj33lTw9pFCqdUxaTosFJ75VTDRkHSN0cf9qSy0aoU6zSnLzV4oFyqdcg4IttbkhuK6dNBBUSBMKGmze1PUUPRBf1AobcwaDKdSqgwK8WHofDgqpHqfaJu8QpWp22mTSOsoRE4XMhw2jellRSITHI887iqTaUPyWgsepD8zjEAtTnaAQzl0kTAdPEdoZNBamA/wU+MeqWEk5FAZezqmImIy5Gm80mkPjK4AHGmfsKBiNhyDJegQVct0FQQSirnOTS9BWmeJkejAUUlNEtGS+IAOpjI5pMaKOhOqwXlK/QZl8HYXQ3QKa0emFRqOTYbQMHgYjqzhYTY2Qt1oTMoLqlZDI7C11SZ1lLf7eGdojakno8Orfq04MISwIW/kIroBw9GDaWpsc7DB3BwPwWvUGYHYxlhjBcHGTFHJKeRo2P6wc7Yq7BKqaaed4j0wEQ6WwphCu9YANOillkHdIKRG40I8E+IDKks4FnWhXeoEDMkhLw1GQwSW1YYl/SEUU4QKPCb1XmiAnuGqQVHfulQrAE465e68TRIJI6j+Esu7BA1c0s3JP9hOIUz6ALdKThqSEkUaG02U0duo3V24FKFn9LORh6TrYTB1dGPYq2ibPrl5mGKXlMYiBk13U6nKpjoXrNdk1D8YqIni+vAITXIfp3YSh1tiBrIeoTrstse1lAQFJY+F7olsaQ/RGlqtLEeTkyrqZohMqR8d9lNjWP8xdjJJmlKCP9Ye06THhpJOCwpYo4mQ+mOqPeNpN0tvqzGpQsK6RRtCD0PVVKd9LbbrkEBvEXBID8jqHnxAsnPU75o8RvLkilgOj13qIlG5yKoewQaU+/AYiKNrGXW+0h/uFtS+9czTnukgYBC1YoATzovYkPpp2FSlyGgRX9LqQo2YkGTrlOPbqc7bODal0RC0ntXahKPpIts4HqY7RK8HGuJ0nN6QNu43OchXFdPHRLRR1iTQ4N8BxdNoWHAcKSmSyON2rgvCGQ/A4wdYUTWoZxkg2GBQfwUNLqHQImJBP9pqmyMj1NCiwL4h2AySAHGNZ33qVi2FGoii1mr3jO/bB3iaE5GukLOo7iGCaHNstNKHEDCRjrRp0+5DvEXUBnpf6VvtPkmGIeK4j73aVD9oSYdkKn6v9E1zThEPM3pZNyNvGXvgxxUqs7Q+U7Si4zaxJtUrZBA6MNBCiwIEsOStNmVGFW4iBqIuCRrF9N2YDoABU3fpN9EUdaUY3RojqGixpGcyjGo8NYim7lK3TVoLfWtm4orUfT8jOu/SmgcspEbeMA1wIbVNiQgpXhSiXkquh28oSYfUOQ+JfU3VAtaDLmWfARQFY2zWK6oYoEeFv0qRBDrCBKkn7hJ4lvE7+IoqQ96mckVNS4eiQXVNoFRJp4zNIhqN2NnNq6ZMg9jH8oWMviSbfllhyCzBGJccz7h57WDMFZ9jS8et+SWrwTwmffa4L639o2ssFYxzNysLVuZqweNS+S6PmBC+4Lw41t5GdXsfvj0CL8aRHn4J/thBFV6f57zO2RN82crndvGn69IWQrq0Ax1AMCVqVuwqQUcXwozmmwOm9GcxWz4dhFleI2SuZK7wYi2FTmgXm2ub3lS2lB5tq+rm0eJCSoEhtCPphVhhFC0dFSlsJ10hysYs8+hgaEsXk6VZFk5QNguFD8OYii2BsRSTnNvKjee0H3JhNpNTWByllGQhM0dRmTM1XLAn/uJnPE5/Y2gu3ekeZMeFCSwoexUmdKi94nXLFtKLCs9wC3MT5NTUjyOyYlEIvGXhFdeSWliKe5mwqgVEmADiQ502QTApYsnK8CQHppHai8NLyclPtk3TLjxB7nM0tyRzuGN8K5XQTCo7xEEEgqcclG0HHqdpwMOs6avlxNkeJLKAGP7gCxgflgB5KQmyFQ8D0hEM+kqmeyQXPJLS8jANhUjgzry7mGqRWeUAc7WEFstM2IKHFoJIJ7ANMa6Uby0iimGwihAfOGiFBgkxCKGNMPGksBlcJc2kbO35PA5jpjF1JSQhy3zNnzCA4SVVgR+0+VOSG1niSoeTr7Efj3IdqlDbcFYilI/4pBiS/LHs6cYWuSJVkt7RcIZj0eYIUcXIpVqoBWCGBLSljpymUNgwh+k2Fy6cxRFacL+EDZxeUxSNGF/bztTGCzAjrbhTXqtypYXHtCLbmCdZYAeCs+/ni2McbctWzeBRtYWw4sei1MwKOUWzgAEaZgXFe2ceXmrN0go8qqRdZq5tF3HkTOOcT3eAz5GhvIYIl9v5DTRYmf5g/Ils49t7F4ZaqRSIJyGBAqLTYUjkiJKCjo+DBMyxVxmF2pIiGygEAaDA3/gXuBid0xyYtuQ2uQluwR4H3g2lMQmygIeKkGLK43Zgh8JypeGX3VK7UlmWozC0EzpCah+55ii7wxRnBlVElYRBiOWp5YJG3fbElAM4cZlQ2lVmYnzeEmW0I9uOMEllHkA/lnkRsay3kxiJyFZ28NlpckHycnBTjRfxyE/zD2wTLHCdBVmlV6w/4vwv4v3oP87OBfF9hY+wrGW4m4nIHB9cxpTaOdZOV5Xp182n39l6P9L1JGZdTrKIs04Ww22eBqJMLTJ2xgSe7GsF/57LYksT54lmUpe7s0hIfq5/LFAUfOszG6Nxw1Wagt1PU2Mh0pQqHG0ZIMqaLAYVJV6COJNk77xN3ERbIl1AlVpaLoUjklbY0pYCLAe4BZjcRl5Iyy7yhMpjhCwDpeNtsDX+7c2QW8q3wePcj5gbc3Lj6cAXFyK7hTLTV8j4qSCQ5gfEyESZhzhO87ZLxBk+OmPS/BuoDChsICFuU01giTLBqOmns/VNchfKiUbFBIt5NjbybAvbfRexvfXb2Nnhb3/CMJPfAxG59Xpmfe84Qg0C8zxZ3Zx+HYN+QPKwvzLJO7lBNaVDflWkLBh3tTJeIiVhrZq9E+AQsIpDB/p1ViM+9lDvOCg7dqJQi8mINif02RcZCi3fOsYqMfGuIILi4WN0yIyK4Y48QxsVTGaCviLeQJtcEUR2BpkBTKgmcFN+OEFQ8Bg9uluPwoqA/wze3Op6DiNi46jNiC95pWVplJ1Io8LJBASJwJj8d2ZV5tcxwUj57FIaEPqDT94lNUJNqUDDg3jhSjdivNYzTrW7rltlVXawsJyzK7ma44k/eY0PUov/hDb6jGCrVZGxH1eRz2q/hg2fz1u+mmPCwxBrEBbzVA6llyCCEG+8IT2KJCsVyvPCBaQpwl2JNuY35QxeyAK8c9pDkooxfXkalVWgnsfO53XXLUQiIQaaqyjhRezLPgXe5JvguxqoRVOl+SjPPP4YhxTRz8+KEYDsEbVTPrLJg0pM/jYptuQWqubU7Xz60h6b25OJeJPkDtVmLSsVzUMH7yzzKotEQDI6saAeLRnDXEvFEA3WqmRIFrz1LSNlSaB/GJGHKq4pF0Ct2o7ICNcF7bCtF1CaOVM6vVt5Tdl0J281Ev7HAa2tkBtKM/77EFgojnPC3ZoD5Veww76lDFwi9/MBVTDkBrQdtraNT20RTP4Lq/0toqAcLCIQ+KqHIfaEj0hPyCoVCIfHnjblmhdBazJVvAlHW8YfG8zVMeMfZ3FY+GTMojJLth7Bvg3sM+BvJDGOlBQdVCpiqnNTEr88/niuYYrkqQMlZ4G0TCpuPoQyzWPKB4O3tAKAbKovdA2pI2VFsFkABuSJ5VuvRIBR2jLxAsTB5s8jCJRQP6VIjigLsXSC8duXhDBxfbWx7VXwIVgL/vSIzIWrXAWVkIBZTK4g8jxMxJRSiEO/sHnrd3GMK1A0xNarYAp/HvGgy7Z+BnKayQDBr42g4Ef53RZi5pOwg7zpojZXUMeBoGzwIPZMja6T2Pwc4oEatc3fPqOWcpYaL13N+CfJXB88bk08pDKLny3YYTAsZsYmH+eMFFaIMV5tJMzkH6ip8djkVmS5gOK+kk3uA4lx9VYOZhDsTRIVbBMz1xNFAvG+wPtVUmr3gzNeTKaKzRh7VibXM0t5C9TV8AuZOIW4mNyC2dnoCX+OhQ7lx+a7FQLs7zi1US4cM/lzF9L2w4wtSG5qy9aDpma5SagwRKrCr4uqhY3hXO1Cu9fwj8S94jYxuk8IVpkShZIjqcPJG9poJU/Q1EgTCsNlglwIyBjlAno3n8XU+zGdspdqpOKWL1xWIUVM8lNojcaBWc5tqLs2fw/m/iIMTaIdiaOpd4Sq8/l1SN7JhzAe9RaSfYXxLQcGULH5rJSa25FGatOPXRAWsZg+wCLKM+CLzlEqUvih6Wdrqov07FFlEM6+AHPS2p1DYFuGlZDumqSDA7qzbUhKuMMCtyHNMgpWtw7HMEOGSxWOTpYdtnF00QNBKssh1eb4CRpzUwyFGzqr9ZC1IaxsoX3TKlLPw2oskCyLwohBkoDenIDSpygxoip4guSBE9Q67CeVh6qCF9BJDqRouCxwfHhINek9aKDwxqpX4QHqlGS2B/4VLsBhDbRaJI2c2L2G2wn369JHLVg0NqBdlFDOiamJBbPCCGqEMDlegxtYfBZhbDM30tS27WleWKLIDjNZeMuBRyS8KeaIr7Apxc6GwUQdy+1GtByjSXeRB2FolR0OZebJqpAnO9QFtBMzziJDy06SADvb6NpluHcXepPLGW8SgZjmxTRWjKnCYyoySjkEgraaqij00hYYSzcVgxZioC/n4gieZFWPKk0ZDgo4ZaA/T+xNrYakntldBy1SixJZAX9MuvI5eARR7iTkK1JeQjR8QYsf8DDzA9OSkheo2UNWrOhi9cEBEbqhzaHPJKRkIkQ2P08UNl25MTOwtsV9jFKEegCL6naISG1GPHBoo2XUJgQrsrIsbRMSSDXT11F881io6cGIIIjFbeYsBGVf2xb3HWqYGjxq24h2JGzT9NPKwWAw1m8B0aSCZtdVtKYEr3jOUhkt/QIiDlkIxsV4+6FRhbZirmoOFIXyl+EQ3pKpEK4dktt5lCS+1JXQTzThNF2RUErVdL0RArLAnTJq1qZ+j3lpBVIJqk4KpxLuETZxq9HOnLhex5LkBtXDilbOvHaIZYplHxRV0I/pzohlWEQJxbwsEAGFaZsyx1aZTmICBq5fuprNKYWywI3WtLjjijatCaDdIGtdeWagk7QeQGezMrJM+LR4QH2BWVtBNOFb0iZ2uKprDk9BqCY5bJKBjiPCGHOVuglSEg5qA6f8NgsnXdNcOAtmCoSXtBFDq9pDo+KwbgJuIMGpWYSaB7sCYzz4g3jXim1henPXomgtU48CkaVYsAbPoqUl9kUNFZSnNjXBLAC1qEXTIyVMlnEUi0WxXQEU4L56ikCmJSkcAo4k+g7MIgnGCBwkMBgNRlhe2SzWYNpcWYYDmYi1IJoxS3/S8YJdFIIwI/P5+ipbYpC5AGEuoghHZl9UsYoOym1SuWXomDAq/BnbJFkuvkxSpbcEJiHrjM3RIl+IEJ9KT9Ii2414kd+agt0SFtKb2ivL3phmk8MdjwQTl49vcqCEjAAznAe/Cco06qnJZ3ij7O85vAuwQr1A0ahkWRd9G4zmLK4wp7zE1EHIEyPyTOChIjuUCIZ35oPQVz5wg19oiTKWRbkksxWcfwM4EUKGs5ompiTTtLGEdrCV5+rUCCCmR/YpkYV5xD2UUqtG4WMmkvHQhHtCHGjB80fNmiAza3LgQ9rX5J6MhEAoyRoFAYvCKqLYE7nkKS+2o3CjzFhUouo7EfoZMK0qc70Ai6Cl2S5Ch4kWiQKrGMKnmhG4V3Pt9H/Fsa6A8pYiwk+YBNx2m+XYLHJqWnXKxJKS1H1RP1ysK1BfXpan9WaAuqbNoijed6VIaQyfxLR0RnKZYgwAo9qspikUWzlWlNJQ9PAkwhMbWmbhiCZY4eSTMgtR4pBxS3M2irxChZFV7OqXleUthsQVfJcZAJGOptIn9aptmhyte4EApS4bkSk8K2OORQK5IXml7HOoIRvGeApaK0GKmOVjswArVROKh4gkhUpA12hHdo4aYMIcb03X0qSQgb1PqXotAsfDM3Em5HYHCkGkSI/jkUo7E9HKft+Tjlm9NLqmQWsSJMEFyAhtM0UX8NUUmtzyaWeCiRYbyop70O+AOHPRVboWWlXQuaoQJ6AYIFoxkEuLUjB6b5erxLsTrZRzkZwu3PuEkjTnAUxPTqWPeMEwAzy8gorh6AD2U9ik1O9SuqkVCndtg8QrMZ7D9XOMlvNBg7JJlG9Tqw+PbRAGVkjL/VYrkAFxvgeBRWEJNQpczWKcgCEZSXYLSTpPhRYUZOmYmNkyJyvMsTnSkSotYxStFfRmCDtD9NBN03U54Vp7zEoBZBjKr+SQvDJWc8os8mlLFOsAYOXUhysht4jzETtwK/TgopSuW9kbMKQn3GzTcqVA10UWSHIEtAP6fshezJore9n0X7UqyTX4N96O+qV5b66CxHqOY5aJicWceXVCE06w0ZzzyYr1wz4LbkC0km6Yrs9pUxjNcryom95TCbO6BN3HROiYlozTshIVdvKIaxQTXtXFmpFLp5QkSTNO0p6cRMQuHaoW0JAF5h7lHS3+g0uJK+BMi9YyHRRnWnBF/FYKEoKeYPVq4sOj1DdK06jaxMp04oVYUXXcDMOj3aASWKd+o2zIUTjasDo6AcsyvarpzWiqu1Gy7CYxpDBnhMwicYQZeH4Xss6zeHHaBakAGog8Eu51m0Gq26ZgxhdKGKd9IfKGWVS3iSW4jBG2IU1GkACQvuO14BTbdzEWUENN0bywACQCkhNFEXGofbVQcGkVHK4TaCLkSpvO/iCGkOfY06wUORaPHJtILbI9aRaAKT1pdSpknk+Lhgg1+AfaDfWW9G4C9LRFSlmK1XmQiKYBOZ18qawJtgf9XVajVWNB+l5rSFrpQ394jhUWtjok33usEZFLOmtIHEUnlUyJo8BR1GiTaodBkJ7o1Gq8ItkFtIa9IPWSv/f0yUYRaA8dE7rb2C8i9lRCipDMZqQPKJUCylASGjL0uM8jF06jT6Qw8VilJQcbfiTV4xQp6JN6IkVM8eSjzhVSDHHj2gEdLzG6jM2h+YfDR6E5+QMaZgtqWjRolY1Vw4BgkRo8GgS+nGo2KqSFpZJWXCEQkGHSLOEZRCNpmyYvw3sLBAnToQhcZ7t/wQFSlGYhV2AVNWvUN9aQao5DXEAalTAOkRH4S0Pd2RT8tHIZUNhqEpfgBZKlZc2TqMydMuQG8hc4mL46HYR0IgTkq6nHRxqxWkBnV4FbBHFEbTZBhyhWJO1J8JsehRiKFhftQqCSA6nF1NTo0QtEeJr8b9ExRCR8oy057QDxjLxUtI4Oc30O5RolZgWOFpW5DorzKNyLjBor/FxoCIWmmhY1TSvGp7gWJ1Gp1ZfwEp1cMknCSbelxhihzToBnZIx4oOKf5AwFGKieIvOGYLFJK3lAj1d54aBQH6eQ+0GJq2JHIlGUIfVnLFvVS2ZE7iy5fCi+1solm65t2iRSJTBqjnfRctzSkXoBUxoWGJRhsI4DWYI3RTzlKme6fc1LW0KOqUHbQEciMCVWDSnx2TpjM9wLZV0KTSf4lotrZf2l06Urig9q/TcUonlJau9OqyUa6rfaa/SSdFK0i+Bu4fddspWBt1Sl6n+iD6qNRyXc4eNzRXJvSYz15TSFZxgk+5K6pAy7ztsNC6Nh6viZXLrUo/9FrM7Df4pLibfnLzghsk9k5/70E9K9gWa5gV8K5rMibfryTX+5ODkY3yZlSZfk/owl5Ovbf2S3N1wwnk7WnL5/si9nn1Bbr6NvWJy+6/cw/8T5+PJ7T7jN984+XtraXKf04psdtfkEWu//f6vT35kqaYm7508Itjmd/mXOb+Qb34VPek34s1vfMB/I/+FzS8i+vZt/RB7WC82V/8p0p/0+OaQXyLl1l/y+evGk5fwxa2vIRhvGvGHn8SHN5RuKd1Ruvdp+ZA8SBc/mg9m1Iw76brXwdhc+Niia2hn4NSPyMblfM45vnKqzPx7ffs3PHHbxevzoYpbt87CwXesnJL1A15rZVAV2m863uGLWyt2Szc7m8efur+fX7q7dF/plU/X34W701pKzm3R5Y19c5Fu4XE89OkyoJZFYT0L3/PsMju7tLnLXjyYLNR69jqPF8NK1uzoi9YWw+qcd+csIHh5dIpnA7feUNm+xYuD5QtcPpLhgqx7ZTeSq4vW/NzmBTtj4e+AxbMR+7eXXli6/6mjwdrDgcGDLr2qGRopLhIvyMRqjXNzZVXvECjvBw7D+27IgxUv9NDwQeXPe2JufS1+nVVbE16nEs0AgX9uBS++kL97HoJ2IRTxunb2Rvwd2UE7vORJHL9TDtyKLLin9ODTyYFu4XO6iizNRuYTb9NEMMlBHzcZdC1zif4Mwv9jPLPfZ2W3oI1byeYO8oXLw3Zrnsv9PFjy9wzKSxqK85ZZZMAu6wN62R1IHsr5S7NnzS3XHb4Wrl1g8Qxia/PlO2IQ7IDBsxD7d5VeBBRe83RwKKK/l5mPRSDedVrr08WjlnlhTM/pw5XdTpZqlATadgZ58AF74WRwPFXWoptUddjhcqF5KuTZVbp96X12x16VHc39NzlxRduRFf/bmSBTac7fcpnNV/hi185unbter76c23tGo6j7Fr88n23+wVPOj5Olq0rXlm5+mrj06QpmbSoAXR08o0Jgf1ZHR8K4pe2b5X2Vu2bh2Y+lrtKrnnvdSzr65rdZm85Ojtwpxq8oXX8+XEMRTleBT6stXa1PH+0cZqAYkH01G1nmsz698WAGsf3TcuGovG1lr5y7lr+Y71r6ifWNjfWO7g12OYOZ6MjKwL9kuSHmds9f4l+lkqwp5uaEt6hkzltS792/y+qtbr7uqWLwLMTxC6AvHyi9+ulrntMkP9gm+a6mT9aN6dJ5ujZ5xjTDGyd081qZ3SAbzTxo2tWavSGXa4tH75W5ZXdWXfsNM+WYByqn+NwbOw9EyzWXr8QHZCbnDhzdCPcPLvzL78ExO+FyELlxG5B5UellT4tnQPZEM0BBpL20XCgf+mzFIdNb0WdmW8gR+vBMZwaQ/Ev03Ad04/L8iqsgR+Y8odwNX64uBXb2eXfPHdx7yyxg0Guvf19r5Ua1wCyuJ/9g25+0y34wtyh23Vq57Y4oP7C5uiMOO2nQy84HhZTuVXBadLa6RVc7fiJADsxCh/5mxGUwF/JoYDG5r+Go7H9FgMNVwtsI5O4FO6i8exZA/DTX3059/bFKmq7Mce5PvkFYBJlemv/Od556H3AT6sMrSz9ceuj8ujJNn4mnZsCiDzEUbbD5tJEpxU+cJTMozRPdOBpnly7dbGWXzvn6VyOHnXiOvWi37HnevPbx6fLcWeBzsIUO/WK/tXQwsrnwm5pzd9DrtezuvspLz06dp4PX80uvLb2x9JbSO552VT+7iaaPsfVSc9+HookGNgY4TR+zfeaA441D5Vuau/T8ZTJzr9DrOlzdP7du77Nly44qjvKy258R+K5IrvKOu9k8b+ydO6ZqR2wr2KPaQRJU7Ijna+UVccf3DWKwI+/dez5Zt0PNmbYlYEWjgukOHGmVPibeMffCadFNOrL+eAZU+MnHI3PVXZXaXKAzW5djXnEFz8K71ev0vrK+0H5gRqR4JiZfWQne3G6+w7LnPV4NygldZbURvk1ftGA5mx99GnXqpaVXlV6PrPvBoUUf89peNUyzbaWXn6HzzB0crGcCrudplaRvLlt3ZqqZyvhSPnctvsNysGJvBCvL1f3PAGQfkXtvnPOb1kgGIrs8u06kB225Fqzb+7PND+5Mkzvm2LXIsVeWXld6c+nhp9vj9+m2MdN7H5jPI26DRJ/D3AnWDkk/kuWjWSi/cPXilWbD1U6cJnWdB1JmLZ5cKhsna/Xj58jBv+Hhwn5vKbLn3zkTSWjvWbusXF11+Cq/QlZ5/cjqVU5r62xcf6vSGameijf/9KnXusvOZ8V4R5akpZtilcB8vphutTOjhYJzEu36yqOxyHqVsr0iRFLtl+915TOQW80gsXMnO/yqNreTkxdfYW/u2xGM8Em0+otKLy+9Burjx57+GRMjParm1jBmPaG7YwNFn94lUWL16WYLOq394PNpwuX8gfCqqLVxt9s5sXvphnP7qZbev7bf7di9gT2ayQmWeHQqn+Nze57tq+zwBv6av/Zs8NprfFk5dXfxy/vbnl7rbX7zKeuNa0ovPJ8KVnChub+dWWbIzPLmsGuo8ckANNvNYn3oX+zl8auYtXj15VUuV92kIjZsvjxvRyfO4cD/aK9Y/qLOnZ+YBXwXQ1wc+eDywi2XObx1FedVXv3E49rjjXStd8Hmnqe6dvTs0q3ns0ZNt7owJGfu6VednpocTs9MdjNC1PRteWs8HLTSan8Wi0e7Vf3qu1pXV60HIud3JL/q1EYWK3uX9efW3MkH7cbJ+z90x0bvZ2YBzLXNU+71a0uDzErKnvQu6u9pr8ulXK8du+Hd/mL71FvWr73zvs2vfu+adO69U69CPj2HVqif7t1TFd04im5dCASK02SDXMzsjqqJqxsXMN1a5O5iaHdme3/VP+RZ6qkFHX9Uh3/V2lSPv9vqk/n1ZkT8naV7zsuvdD/I7R7XnIahm7zQPTPMnfRm6GV78YS97Lstvr56P/P/g2XdHdbv5PE1crb+/gM5f4UtD6oVO2seOu7ayzbXsnrh0A1Pfue75zh/Z9/fW3pJ6WW0Sv20fU93eaSQHoJ4qlaL7rAxPSdc3HTG1AK6QWBxY7bO7KBw7WoyshdiL+8sLMuDcjX0E193hFT140l9uc3bC7x2Ysa42M2+7XfsgRv7XkevJ6t+/Wiy1HaXUeEzN774CdB5rH6fi89zS3eYldIHzhMh5EV/vM07dLeYPrGPuV0ulYjRGMp4dsgcX/UbN0edtbrwGi63/bLnxidbId8fy3DGvLT+Cnc55OEeW69FImwIxefe/lP2Za5/JNz8d4+HYuc8+YGgYO5BOS3QeWsfy80rI7r/VItuJmSgmR0KN73TyhLOQ7eR9Nb9MI73qOeF1VOiPphb4smNkbhpxli8m+5twFN79x43bMiTPp+/ZPlYqHv28qZ3TlaEO2JxE955EB0JrYeeT82gs5nmMiIoWHM3wGFxbRcVD3T+5h5T5tx+a3rys2bOtM3sDuiNq5zGcV27ks9dtDInebiqncANl3VydMTX7XmH28ty9TfrDR3r8vtmXV7yF5Yby5fz+pX1S2paHnfrePi8v2zxff56gydaVXh9q/UEXLZzDj2rdB2we9755BBhhj5kWuN7dE/OEV1sNCtMbvtlO3kxd69WzrIrubNv+bYZp4jwqgn3rNddbbvJ7Sd2qdYTZMaT5cYpePj5ePfFdPb//PycmfvnET919tEVRhaqhmkd6G6F1NCjk6/MsJjftLirev3aMe4tLr99fb3jrq6jmdvf2z/jyI+GcTYnq3vDK3X9YLWeNRqXXsZX1Kpdh8Tau9F27M7G5iPngrIzJjeierwEtYNWJc+rfmTmtD/d+8vcadXciK5QVwCnuDIpf2a4iuurI1Y/njYl+MkPXX/Zzo7IdnPXe8BRuaPX8t96Znjq1rh6pCYXqoHn17R9uHHB0Z+8N9zTG71qR4raGadLTGW5p3Q/ast51xUI4oGyjCCmG+9nBVLlbp4V6/x4OW/NDqBbGyftxvF7Jn+k97Ts/Y4SXhZzvfLBddda3ruxMVtU/kkuvKCeta9857tcu1aNQ0fZP2vbzNLvSp7LwyvCW7dq5+bPzhr4CtSMO0p3I4fOh9HyVnW78R7R/YHpTuh0yuw0NIPuzODY/FKrtjexeyEL6zH/hLvUM5i4eKLfO1ss/nm0xssf0SxI/knzypynGrYBg3lsc/fjUQieRP++CnrrTbSOeH6dIsp3r+AqWqVK6e6K5g6Gp6+h73aeMG1mV2nujyLr5AKvOyt2U7fv467/SR3WjkVW43Zen/zj2Qn0ktmi9X/k3BWuP+jY9fkjxxzG9YLPufST0dBPjtpnJ9O58D0JfvdCK/9I6W109cD5rLIYtKbr+QRR38A4rUXbrX7R6Q+6EXtGcbypfjis+dxdthdVPQ93693zkSfWNG9cKReba2sLN3z5GcayObToJhSrVb/shi1/VdaWtV09nix29tT5XM096n5vSJ+kXv1Q6aVQFG8oPURnOs93daBYLqYGla5e61ORomSkG7zuUMe6xVW3M1xb+1d+yl6m7wxqnNtVzuNQ2zXNJ986G8b368OCezMW5t/03+0tuzzcQx9zi5NQhtxt2PrHEleeDeHPSudK95i/+ZXvn1vvLL2m9MPIzh87v5XlzFyLvi0NaeWtbxbezBP6LxiKvvYZZtf9car0WmW+a++2o7KbhLHNa1fPJYdlNpaVBSkbN2jhPcM0+0159y5d62244YKOj9vLF7aO+LKV6GVbfs+EfDKd/5LSq82VB289X/1obj1cANelhVX6P0XozFtnB0lZFFQ9S0V5V/3ZF1x0oydrF/PFTPOgG8ULscd4NvnG2dh9WHZkrnU7PzBrlbn8oD289u6FQ1UuTyIptfQvfJzg/JwcDHjvieTmk+Tjs34AXUBegJQVZ+Ky6ULFMy1tPvnBxH5hnI1svezanrvREJM/e2YTLYkjIZ3mrdfbnB+95ETTan0fKVaKdsTmmtILgMz5Z9n2CkdaXFlPKxw7wZPlnUFxN/hCo9ZSPbsse3Fy3eK6nL/MfT73F5fDyd+eDdcf8D0dN8/dttXbZ71txvolHoRZg9f3LF7oXlOr1Rvz8srH6ZUH1VGtmm794Y017eUbW42ntFZ1PVTpK4DlG0o/ep58SSAeYebTEOY/tajRfwmwY/9tPuFCy7ozXGqvneT1kV3LrXU/DN2WlvWLF72T57Tj9qLb1bnd6s2aKueP+OlRnsjL3bpMRsxqP/89j6PKW+093q4LNj/7/a+XHEe9e23p9UDvbed57rZmzkZtS9HTHWK1UKZjc41yvn0pQ3fw2BLKTEG8v3K1rl127+SL5aB8uM4bXtNd0ouvCO1f0nFyLLEbz+dXd113eYPvPjpr/CqvPfyct4fv4Hr+EmnbF641a5cck3Tr79BH9bOywSF96UP8du4f61xzbrljpTO+Lij9f4JLRUh42mNgZGBgYGRwXOR0ZFc8v81XBnkOBhA469qrgkyzLWE3BFIcDEwgHgAf6AjeAAB42mNgZGBgN/x/g4GBgwEE2JYwMDKgAn0ASyQC8wAAAHjaY3rD4MLBwMDA+AeC2dkZUthZGX4BcQpVMTt1MeMXBgYA83IXSgAAAAAsACwALAAsAL4bDhuwHGgdLh3qHqwfeiAeIOAhrCJwIzIkCiTsJcQmnieAKEYpJCn+Ksordiw0LQQtyC6OL2owHDDmMboyhjNINCg1EjX2Nto3vjiMOXI6Ujs0OzwAAQAAAC8UKQCgAAAAAAACAAAAAQABAAAAQAAuAAAAAHjalVHNTsJAGJwWNNHExHjw3It/B5sCiih6IDTGgwcCRs4FSiEUmrQF5SIv4dt48GBi9Im8Ovt1Qa626e58s/PNzm4B7OITBtSzPpoyZzgnKMN5HKzwJudDrhr5LVavONLYoOpNY5Mr7xrn1nCe7xJv4BkfGm/CNKoab+PFuNF4D9fG0vML+8aPxt9wzJ1FLU6TRhTOB34v9kJ32PXdomM1/WAaerHV9jv9aJIuUEOMlDETNBAhxBwD+OiR9Vi5GKLL2kURDiwco44TmVsYYUpFSO0UAV+fPXOuNTj79EuotFmrTgcVwTXpsNCkb8CdUqpUpfSqfyZ721jI9yhcQm2ECXUFssqrgCp3aZHJqj92QGXKxEo/W3XYuOBYxZhnGtFTafpkQzp3mM/GuXwVlFhdcucHOg0lW1+8UqIndiumK+fzyKmsFk+vEk54Hgu3Wl1faSIiS/zL4haTGRPd6Rs4xT2ZQO7ZluTjf/4TdXuB/AuPijarzlrq7AZakkXlU6uKLct4hiu6lDhmTFHusfQLhExwggAAAHjabctJcgEBAEbhr5uKAziCeQiNYGuhjTFPRyBVqVQ2Fk5Ps/Y2/1v8T+jFfaDtHU2CMEhJycrJKygqKauoqqn71Eg+kVbSd3zp6ukbio2MTUzNzH1bWFpZ29ja2Ts4OgXpj/Pv7f/Sylz/fqIoGj43TuQBiIUSLgABUR/cpAAA";

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isInsaneDicebot(texts = [], hrefs = []) {
    const names = new Set(["인세인", "インセイン", "insane"]);
    if (texts.some((text) => names.has(normalizedText(text)))) return true;
    return hrefs.some((href) => {
      try {
        return /(?:^|\/)insane(?:\/|$)/i.test(new URL(href, location.href).pathname);
      } catch (error) {
        return /(?:^|\/)insane(?:[/?#]|$)/i.test(String(href || ""));
      }
    });
  }

  function getSkillTarget(acquired, targetId, removedGaps = []) {
    const [targetColumn, targetRow] = String(targetId).split(":").map(Number);
    const known = Array.isArray(acquired) ? acquired : [];
    let distance = Infinity;
    for (const id of known) {
      const [column, row] = String(id).split(":").map(Number);
      if (![column, row, targetColumn, targetRow].every(Number.isInteger)) continue;
      let next = Math.abs(row - targetRow) + Math.abs(column - targetColumn);
      for (let gap = Math.min(column, targetColumn); gap < Math.max(column, targetColumn); gap += 1) {
        if (!removedGaps[gap]) next += 1;
      }
      distance = Math.min(distance, next);
    }
    return Number.isFinite(distance) ? 5 + distance : null;
  }

  function getCuriosityGaps(value) {
    const gaps = [false, false, false, false, false];
    if (value === "" || value == null) return gaps;
    const column = Number(value);
    if (!Number.isInteger(column) || column < 0 || column > 5) return gaps;
    if (column > 0) gaps[column - 1] = true;
    if (column < 5) gaps[column] = true;
    return gaps;
  }

  function clampDialogDrag(rect, deltaX, deltaY, viewportWidth, viewportHeight, margin = 8) {
    return {
      x: Math.min(Math.max(deltaX, margin - rect.left), viewportWidth - margin - rect.right),
      y: Math.min(Math.max(deltaY, margin - rect.top), viewportHeight - margin - rect.bottom)
    };
  }

  function isCharacterEditTitle(value) {
    const text = normalizedText(value);
    return ["캐릭터 편집", "キャラクター編集", "edit character", "character edit", "编辑角色"].some((label) => text.includes(label));
  }

  function findLinkedSheet(sheets = [], playerName = "") {
    const key = normalizedText(playerName);
    return key ? sheets.find((sheet) => normalizedText(sheet?.player) === key) || null : null;
  }

  function nativeStatusPatch(rows = []) {
    const patch = {};
    const fields = { 생명력: ["life", "lifeMax"], 이성치: ["sanity", "sanityMax"] };
    for (const row of rows) {
      const keys = fields[String(row?.label || "").trim()];
      if (!keys) continue;
      patch[keys[0]] = nonNegativeNumber(row.value);
      patch[keys[1]] = nonNegativeNumber(row.max);
    }
    return patch;
  }

  function normalizePermissions(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, flags]) => {
      const name = cleanText(key, 100).trim();
      if (!name || !flags || typeof flags !== "object") return [];
      const permission = { view: !!flags.view, secret: !!flags.secret, edit: !!flags.edit };
      return permission.view || permission.secret || permission.edit ? [[name, permission]] : [];
    }));
  }

  function validSkillId(id) {
    return /^([0-5]):(10|[0-9])$/.test(String(id));
  }

  function findSkillId(value) {
    if (validSkillId(value)) return String(value);
    const name = cleanText(value, 300).trim();
    for (let column = 0; column < CATEGORIES.length; column += 1) {
      const row = CATEGORIES[column].slice(1).indexOf(name);
      if (row >= 0) return `${column}:${row}`;
    }
    return "";
  }

  function cleanText(value, maxLength = 20_000) {
    return typeof value === "string" ? value.slice(0, maxLength) : String(value ?? "").slice(0, maxLength);
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegativeNumber(value, fallback = 0) {
    return Math.max(0, finiteNumber(value, fallback));
  }

  function copyJsonObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeItems(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const items = Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([key, raw]) => {
      const label = cleanText(key, 100).trim();
      if (!label || raw === "" || raw == null || !Number.isFinite(Number(raw))) return [];
      return [[label, nonNegativeNumber(raw)]];
    }));
    if ("기타" in items) {
      if (!("보상 및 기타" in items)) items["보상 및 기타"] = items.기타;
      delete items.기타;
    }
    return items;
  }

  function normalizeTransferSheet(raw, idFactory = makeId) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("시트 데이터가 없습니다.");
    const curiosityNumber = Number(raw.curiosity);
    const curiosity = Number.isInteger(curiosityNumber) && curiosityNumber >= 0 && curiosityNumber < 6 ? curiosityNumber : "";
    const defaultGaps = getCuriosityGaps(curiosity);
    const sheet = makeSheet(cleanText(raw.name || "가져온 시트", 200), idFactory);
    return {
      ...copyJsonObject(raw),
      ...sheet,
      name: cleanText(raw.name || "가져온 시트", 200),
      player: cleanText(raw.player, 200),
      age: cleanText(raw.age, 100),
      gender: cleanText(raw.gender, 100),
      occupation: cleanText(raw.occupation, 300),
      life: nonNegativeNumber(raw.life, 6),
      lifeMax: nonNegativeNumber(raw.lifeMax, 6),
      sanity: nonNegativeNumber(raw.sanity, 6),
      sanityMax: nonNegativeNumber(raw.sanityMax, 6),
      merit: nonNegativeNumber(raw.merit),
      etc: cleanText(raw.etc ?? raw.extensions?.trpgManagement?.sourceData?.basic?.etc, 300),
      curiosity,
      removedGaps: Array.from({ length: 5 }, (_, index) => Array.isArray(raw.removedGaps) ? !!raw.removedGaps[index] : defaultGaps[index]),
      skills: [...new Set((Array.isArray(raw.skills) ? raw.skills : []).filter(validSkillId))].slice(0, 66),
      fear: validSkillId(raw.fear) ? String(raw.fear) : "",
      modifier: finiteNumber(raw.modifier),
      rootLaw: !!raw.rootLaw,
      abilities: (Array.isArray(raw.abilities) ? raw.abilities : []).slice(0, 100).map((item, index) => ({
        ...copyJsonObject(item),
        id: cleanText(item?.id, 100) || `${sheet.id}:ability:${index}`,
        name: cleanText(item?.name, 300), type: cleanText(item?.type, 100), target: cleanText(item?.target, 300),
        cost: cleanText(item?.cost, 100), effect: cleanText(item?.effect, 20_000), memo: cleanText(item?.memo, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      people: (Array.isArray(raw.people) ? raw.people : []).slice(0, 100).map((item, index) => ({
        ...copyJsonObject(item),
        id: cleanText(item?.id, 100) || `${sheet.id}:person:${index}`,
        name: cleanText(item?.name, 300), shelter: !!item?.shelter, emotion: cleanText(item?.emotion, 300),
        detail: cleanText(item?.detail, 20_000), memo: cleanText(item?.memo || item?.detail, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      mission: cleanText(raw.mission, 50_000),
      image: /^https?:\/\//i.test(String(raw.image || "").trim()) ? cleanText(raw.image, 2000).trim() : "",
      secret: cleanText(raw.secret, 50_000),
      memo: cleanText(raw.memo, 50_000),
      profile: { ...copyJsonObject(raw.profile), catchphrase: cleanText(raw.profile?.catchphrase, 20_000), setting: cleanText(raw.profile?.setting, 50_000) },
      flashback: cleanText(raw.flashback, 50_000),
      respec: {
        ...copyJsonObject(raw.respec),
        newWorld: !!raw.respec?.newWorld, session: !!raw.respec?.session, roleplay: !!raw.respec?.roleplay,
        gain: !!raw.respec?.gain, empathy: nonNegativeNumber(raw.respec?.empathy),
        mission: !!raw.respec?.mission, other: nonNegativeNumber(raw.respec?.other)
      },
      items: normalizeItems(raw.items),
      madnessState: { ...copyJsonObject(raw.madnessState), current: nonNegativeNumber(raw.madnessState?.current), delirium: !!raw.madnessState?.delirium },
      madness: (Array.isArray(raw.madness) ? raw.madness : []).slice(0, 100).map((item) => ({
        ...copyJsonObject(item),
        name: cleanText(item?.name, 300), trigger: cleanText(item?.trigger, 10_000),
        revealed: !!item?.revealed, effect: cleanText(item?.effect, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      permissions: normalizePermissions(raw.permissions),
      extensions: copyJsonObject(raw.extensions)
    };
  }

  function parseTransferPayload(text, idFactory = makeId) {
    if (typeof text !== "string" || !text.trim()) throw new Error("붙여넣을 JSON이 없습니다.");
    if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES) throw new Error("시트 JSON이 너무 큽니다.");
    let payload;
    try { payload = JSON.parse(text); } catch (error) { throw new Error("올바른 JSON이 아닙니다."); }
    if (payload?.kind !== TRANSFER_KIND) throw new Error("사이코로픽션 시트 API 형식이 아닙니다.");
    if (payload.version !== TRANSFER_VERSION) throw new Error(`지원하지 않는 시트 버전: ${payload.version ?? "없음"}`);
    return normalizeTransferSheet(payload.data, idFactory);
  }

  const testHook = window.__CCF_CHARACTER_SHEET_TEST_HOOK__;
  if (testHook && typeof testHook === "object") {
    Object.assign(testHook, { CATEGORIES, TABLE_COMMANDS, SKILL_TABLE_COMMANDS, findSkillId, findLinkedSheet, isInsaneDicebot, getSkillTarget, getCuriosityGaps, clampDialogDrag, isCharacterEditTitle, nativeStatusPatch, normalizeItems, normalizePermissions, normalizeData, parseTransferPayload });
    return;
  }

  try { window[DEBUG_KEY]?.disable?.(); } catch (error) { /* previous cleanup failed */ }

  const abort = new AbortController();
  const signal = abort.signal;
  const state = {
    active: true,
    roomKey: "",
    data: makeData(),
    open: false,
    view: "list",
    renderFrame: 0,
    collapsed: false,
    embedded: null,
    tabContainer: null,
    saveTimer: 0,
    dialogPosition: { x: 0, y: 0 },
    openNotes: new Set(),
    nativeCharacterDialog: null,
    linkPicker: null,
    tablePicker: null
  };

  registerWithSuite();
  installStyle();
  registerMenuItem();
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("paste", handleTransferPaste, { capture: true, signal });
  window.addEventListener("capybara-toolkit:route-change", scheduleRefresh, { signal });
  window.addEventListener("popstate", scheduleRefresh, { signal });
  window[DEBUG_KEY] = {
    __owner: signal,
    version: VERSION,
    isActive: () => state.active,
    detected: detectRoom,
    open: () => openSheet(),
    openForCharacter: (name) => openSheetForCharacterName(name),
    data: () => structuredClone(state.data),
    importText: (text) => importTransferText(text),
    disable
  };
  scheduleRefresh();

  function registerWithSuite() {
    const info = {
      id: FEATURE_ID,
      name: "CCFOLIA Saikoro Fiction Character Sheet",
      version: VERSION,
      namespace: "https://greasyfork.org/users/Capybara_korea/ccf-character-sheet"
    };
    const register = () => {
      try {
        const key = "ccf-suite-registry-v1";
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        const registry = parsed && typeof parsed.scripts === "object" ? parsed : { scripts: {} };
        registry.scripts[FEATURE_ID] = { ...registry.scripts[FEATURE_ID], ...info, lastSeenAt: new Date().toISOString(), lastSeenUrl: location.href };
        localStorage.setItem(key, JSON.stringify(registry));
        window.dispatchEvent(new CustomEvent("ccf-suite:register", { detail: registry.scripts[FEATURE_ID] }));
      } catch (error) { /* registry failure does not block feature */ }
    };
    register();
    window.addEventListener("ccf-suite:request-register", (event) => {
      if (!event.detail?.targetId || event.detail.targetId === FEATURE_ID) register();
    }, { signal });
  }

  function disable() {
    if (!state.active) return false;
    state.active = false;
    abort.abort();
    observer.disconnect();
    cancelAnimationFrame(state.renderFrame);
    clearTimeout(state.saveTimer);
    if (state.embedded) { try { toolsApi()?.closeTool?.(); } catch (error) { /* 창 정리 실패는 무시 */ } }
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll(`[${ICON_ATTR}], [${DIALOG_BUTTON_ATTR}], [${ROW_BUTTON_ATTR}]`).forEach((node) => node.remove());
    window.__CCF_TOOLKIT_MENU__?.items?.delete("saikoro");
    window.__CCF_TOOLKIT_MENU__?.sync?.();
    if (window[DEBUG_KEY]?.__owner === signal) delete window[DEBUG_KEY];
    return true;
  }

  function roomKey() {
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function detectRoom() {
    if (!roomKey()) return false;
    const texts = [...document.querySelectorAll("span.MuiTypography-caption")]
      .filter((node) => !node.closest('[role="log"], [aria-live], li'))
      .map((node) => node.textContent || "");
    const hrefs = [...document.querySelectorAll('a[href*="docs.bcdice.org"], a[href*="bcdice"]')].map((node) => node.href || node.getAttribute("href") || "");
    return isInsaneDicebot(texts, hrefs);
  }

  function scheduleRefresh() {
    if (!state.active || state.renderFrame) return;
    state.renderFrame = requestAnimationFrame(async () => {
      state.renderFrame = 0;
      const nextRoom = roomKey();
      if (nextRoom !== state.roomKey) {
        state.roomKey = nextRoom;
        state.data = await loadData(nextRoom);
        if (state.open) render();
      }
      if (detectRoom()) {
        mountCharacterDialogButtons();
        mountCharacterListButtons();
      }
      else {
        document.querySelectorAll(`[${ICON_ATTR}], [${DIALOG_BUTTON_ATTR}], [${ROW_BUTTON_ATTR}]`).forEach((node) => node.remove());
        closeSheet();
      }
      window.__CCF_TOOLKIT_MENU__?.sync?.();
    });
  }

  function makeId() {
    return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function makeSheet(name = "새 시트", idFactory = makeId) {
    return {
      id: idFactory(), name, player: "", age: "", gender: "", occupation: "",
      life: 6, lifeMax: 6, sanity: 6, sanityMax: 6, merit: 0, etc: "",
      curiosity: "", removedGaps: [false, false, false, false, false],
      skills: [], fear: "", abilities: [], people: [], mission: "", secret: "", memo: "", image: "",
      respec: { newWorld: false, session: false, roleplay: false, gain: false, empathy: 0, mission: false, other: 0 }
    };
  }

  function makeData() {
    // 시트는 0개로 시작할 수 있다(＋, 캐릭터 편집창 버튼, 내 캐릭터 목록 버튼으로 만든다).
    return { version: 1, selectedId: "", sheets: [], permissions: {}, scene: { cycle: 1, number: 0 }, sceneTables: [] };
  }

  // 장면표 메뉴에 추가한 /roll-table 커스텀 커맨드. 본문까지 룸 데이터에 복사해 두어 다른 사용자(플레이어)도 쓸 수 있다.
  function normalizeSceneTables(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 20).map((item) => ({ macroName: cleanText(item?.macroName, 100), tableName: cleanText(item?.tableName, 100), body: String(item?.body || "").slice(0, 4000) }))
      .filter((item) => item.macroName && /^\/roll-table\b/.test(item.body.trim()) && !seen.has(item.macroName) && seen.add(item.macroName));
  }

  function normalizeData(value) {
    if (!value || !Array.isArray(value.sheets)) return makeData();
    const sheets = value.sheets.map((raw, index) => {
      const base = makeSheet(`시트 ${index + 1}`);
      const sheet = { ...base, ...raw };
      sheet.removedGaps = Array.from({ length: 5 }, (_, i) => !!raw.removedGaps?.[i]);
      sheet.skills = Array.isArray(raw.skills) ? raw.skills.filter(validSkillId) : [];
      sheet.abilities = (Array.isArray(raw.abilities) ? raw.abilities : []).map((item, itemIndex) => ({ ...item, id: item.id || `${sheet.id}:ability:${itemIndex}` }));
      sheet.people = (Array.isArray(raw.people) ? raw.people : []).map((item, itemIndex) => {
        const person = { ...item, id: item.id || `${sheet.id}:person:${itemIndex}`, shelter: !!item.shelter };
        if (!person.memo && person.detail) { person.memo = person.detail; person.detail = ""; }
        return person;
      });
      return sheet;
    });
    const selectedId = sheets.some((sheet) => sheet.id === value.selectedId) ? value.selectedId : sheets[0]?.id || "";
    const legacyPermissions = value.sheets.find((sheet) => sheet.id === selectedId)?.permissions;
    sheets.forEach((sheet) => { delete sheet.permissions; });
    return { version: 1, selectedId, sheets, permissions: normalizePermissions(value.permissions || legacyPermissions), scene: normalizeScene(value.scene), sceneTables: normalizeSceneTables(value.sceneTables) };
  }

  async function loadData(key) {
    if (!key) return makeData();
    try {
      const toolkit = window.__CAPYBARA_TOOLKIT__;
      if (toolkit?.storage?.getRoomData) {
        const record = await toolkit.storage.getRoomData(FEATURE_ID, key);
        return normalizeData(record?.value);
      }
      return normalizeData(JSON.parse(localStorage.getItem(`${FEATURE_ID}:${key}`) || "null"));
    } catch (error) {
      console.warn("[ccf-character-sheet] load failed", error);
      return makeData();
    }
  }

  function saveSoon() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveData, 120);
  }

  async function saveData() {
    if (!state.roomKey) return;
    try {
      const toolkit = window.__CAPYBARA_TOOLKIT__;
      if (toolkit?.storage?.setRoomData) await toolkit.storage.setRoomData(FEATURE_ID, state.roomKey, state.data);
      else localStorage.setItem(`${FEATURE_ID}:${state.roomKey}`, JSON.stringify(state.data));
      status("저장됨");
    } catch (error) {
      console.warn("[ccf-character-sheet] save failed", error);
      status("저장 실패");
    }
  }

  function currentSheet() {
    return state.data.sheets.find((sheet) => sheet.id === state.data.selectedId) || state.data.sheets[0] || null;
  }

  // 사이코로픽션 툴바 아이콘은 펭귄 메뉴(toolkit-presence 가 그린다)의 항목이다. 인세인 룸 감지일 때만 보인다.
  function registerMenuItem() {
    (window.__CCF_TOOLKIT_MENU__ ||= { items: new Map(), register(item) { if (this.items.get(item.id)?.onClick === item.onClick) return; this.items.set(item.id, item); this.sync?.(); } }).register({ id: "saikoro", order: 1, label: "사이코로픽션", icon: diceIcon(), visible: () => state.active && detectRoom(), onClick: openPanel, mount: mountSheetTool, unmount: unmountSheetTool });
  }

  function mountCharacterDialogButtons() {
    document.querySelectorAll('.MuiDialog-root, [role="dialog"]').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.closest(`#${ROOT_ID}`)) return;
      const topbar = dialog.querySelector(".MuiAppBar-root, .MuiDialogTitle-root");
      const host = topbar?.querySelector(".MuiToolbar-root") || topbar;
      const title = [...(host?.querySelectorAll("h1,h2,h3,h4,h5,h6,[class*='MuiTypography']") || [])].find((node) => isCharacterEditTitle(node.textContent));
      if (!title || host.querySelector(`[${DIALOG_BUTTON_ATTR}]`)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = host.querySelector("button")?.className || "";
      button.setAttribute(DIALOG_BUTTON_ATTR, "native-topbar");
      button.setAttribute("aria-label", "사이코로픽션 열기");
      button.title = "사이코로픽션";
      button.innerHTML = diceIcon();
      button.addEventListener("click", () => openSheetFromCharacterDialog(dialog), { signal });
      // 오른쪽 버튼 무리 안, 닫기(마지막 아이콘 버튼) 바로 왼쪽
      const others = [...host.querySelectorAll("button")].filter((node) => !node.hasAttribute(DIALOG_BUTTON_ATTR));
      const closeButton = others[others.length - 1];
      if (closeButton?.parentElement) closeButton.parentElement.insertBefore(button, closeButton);
      else host.appendChild(button);
    });
  }

  // 코코포리아 캐릭터 편집창은 저장 버튼이 없고 입력 즉시 저장된다(번들 확인) — 시트로 값을 옮기고 편집창 값을 맞춘 뒤 편집창만 닫는다.
  function closeNativeCharacterDialogSoon(dialog) {
    const topbar = dialog.querySelector(".MuiAppBar-root, .MuiDialogTitle-root");
    const host = topbar?.querySelector(".MuiToolbar-root") || topbar;
    const buttons = [...(host?.querySelectorAll("button") || [])].filter((node) => !node.hasAttribute(DIALOG_BUTTON_ATTR));
    const close = buttons.find((node) => /닫기|close|閉じる/i.test(`${node.getAttribute("aria-label") || ""} ${node.title || ""}`)) || buttons[buttons.length - 1];
    if (!close) return;
    setTimeout(() => { if (state.open && dialog.isConnected) { state.nativeCharacterDialog = null; close.click(); } }, 450);
  }

  function openSheetFromCharacterDialog(dialog) {
    const result = openSheetFromCharacterDialogInner(dialog);
    closeNativeCharacterDialogSoon(dialog);
    return result;
  }

  function openSheetFromCharacterDialogInner(dialog) {
    state.nativeCharacterDialog = dialog;
    const linkedSheet = findLinkedSheet(state.data.sheets, dialog.querySelector('input[name="name"]')?.value);
    if (linkedSheet) {
      selectSheet(linkedSheet.id);
      return openSheet();
    }
    // 연결된 시트가 없으면 이 캐릭터용 시트를 새로 만들어 목록을 거치지 않고 곧바로 연다(이름·메모·생명력/이성치는 편집창 값으로 채운다).
    const characterName = String(dialog.querySelector('input[name="name"]')?.value || "").trim();
    const sheet = makeSheet(characterName || `시트 ${state.data.sheets.length + 1}`);
    sheet.player = characterName;
    state.data.sheets.push(sheet);
    state.open = true;
    showSheet();
    selectSheet(sheet.id);
    saveSoon();
    return true;
  }

  function selectSheet(sheetId) {
    state.data.selectedId = sheetId;
    if (state.nativeCharacterDialog?.isConnected) {
      syncSheetFromNativeDialog(state.nativeCharacterDialog);
      syncNativeItems(currentSheet(), state.nativeCharacterDialog);
    }
    state.view = "sheet";
    render();
  }

  function openPanel() {
    state.nativeCharacterDialog = null;
    state.view = "list";
    openSheet();
  }

  function syncSheetFromNativeDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) return;
    const sheet = currentSheet();
    if (!sheet) return;
    const name = dialog.querySelector('input[name="name"]');
    const memo = dialog.querySelector('textarea[name="memo"]');
    const rows = [...dialog.querySelectorAll('input[name^="status."][name$=".label"]')].map((label) => {
      const base = label.name.replace(/\.label$/, "");
      return {
        label: label.value,
        value: dialog.querySelector(`input[name="${base}.value"]`)?.value,
        max: dialog.querySelector(`input[name="${base}.max"]`)?.value
      };
    });
    if (name?.value) sheet.name = name.value;
    if (memo) sheet.memo = memo.value;
    Object.assign(sheet, nativeStatusPatch(rows));
    saveSoon();
  }

  function syncNativeCharacterField(key, value) {
    const dialog = state.nativeCharacterDialog;
    if (!(dialog instanceof HTMLElement) || !dialog.isConnected) return;
    const direct = { name: 'input[name="name"]', memo: 'textarea[name="memo"]' };
    let input = direct[key] ? dialog.querySelector(direct[key]) : null;
    if (!input) {
      const statusKey = { life: ["생명력", "value"], lifeMax: ["생명력", "max"], sanity: ["이성치", "value"], sanityMax: ["이성치", "max"] }[key];
      const label = statusKey && [...dialog.querySelectorAll('input[name^="status."][name$=".label"]')].find((node) => node.value.trim() === statusKey[0]);
      if (label) input = dialog.querySelector(`input[name="${label.name.replace(/\.label$/, `.${statusKey[1]}`)}"]`);
    }
    if (!input) return;
    setNativeInputValue(input, value);
  }

  function setNativeInputValue(input, value) {
    const previous = input.value;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, String(value)); else input.value = String(value);
    input._valueTracker?.setValue(previous);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  function findNativeCharacterDialog() {
    return [...document.querySelectorAll('.MuiDialog-root, [role="dialog"]')].find((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.closest(`#${ROOT_ID}`)) return false;
      return [...dialog.querySelectorAll("h1,h2,h3,h4,h5,h6,[class*='MuiTypography']")].some((node) => isCharacterEditTitle(node.textContent));
    }) || null;
  }

  async function syncNativeItems(sheet, dialog = state.nativeCharacterDialog || findNativeCharacterDialog()) {
    if (!sheet || !(dialog instanceof HTMLElement) || !dialog.isConnected) return;
    const entries = Object.entries(normalizeItems(sheet.items));
    if (!entries.length) return;
    const labels = () => [...dialog.querySelectorAll('input[name^="status."][name$=".label"]')];
    const add = [...dialog.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .find((node) => node.textContent.trim() === "스테이터스")?.parentElement?.querySelector('button:has(svg[data-testid="AddIcon"])');
    for (const [labelText, value] of entries) {
      let label = labels().find((node) => node.value.trim() === labelText);
      if (!label && labelText === "보상 및 기타") {
        label = labels().find((node) => node.value.trim() === "기타");
        if (label) setNativeInputValue(label, labelText);
      }
      if (!label && add) {
        const known = new Set(labels().map((node) => node.name));
        add.click();
        for (let frame = 0; frame < 10 && !label; frame += 1) {
          await new Promise(requestAnimationFrame);
          label = labels().find((node) => !known.has(node.name));
        }
        if (label) setNativeInputValue(label, labelText);
      }
      if (!label) continue;
      await new Promise(requestAnimationFrame);
      const input = dialog.querySelector(`input[name="${label.name.replace(/\.label$/, ".value")}"]`);
      if (input) setNativeInputValue(input, value);
    }
  }

  // 시트를 여는 모든 길(편집창 버튼·내 캐릭터 목록 버튼·붙여넣기·코드)은 독립 시트 창으로 연다(원래 창 모양, 탑바 더블클릭 접기).
  // "GM 도구" 창의 사이코로픽션 탭은 모든 시트를 관리하는 목록(추가·삭제)이고, 시트를 고르면 독립 시트 창이 열린다. 탭 안에서는 시트를 편집하지 않는다.
  function toolsApi() {
    const registry = window.__CCF_TOOLKIT_MENU__;
    return typeof registry?.openTool === "function" ? registry : null;
  }

  function showSheet() {
    ensureRoot();
    render();
    return true;
  }

  // ---- GM 도구 창 탭: 시트 관리 목록 ----
  const TAB_ID = "ccf-sheet-tab";
  function renderSheetTab() {
    const container = state.tabContainer;
    if (!container?.isConnected) return;
    const sheets = state.data?.sheets || [];
    const button = "all:unset;box-sizing:border-box;cursor:pointer;display:inline-grid;place-items:center;border-radius:50%;width:34px;height:34px;color:rgba(255,255,255,.7)";
    const signature = JSON.stringify(sheets.map((sheet) => [sheet.id, sheet.name, sheet.player]));
    if (container.__sig === signature && container.querySelector("#" + TAB_ID)) return;
    container.__sig = signature;
    const rows = sheets.map((sheet) => `<div style="display:flex;align-items:center;gap:4px;border-bottom:1px solid rgba(255,255,255,.08)"><button type="button" data-tab-open="${escapeHtml(sheet.id)}" style="all:unset;box-sizing:border-box;flex:1;min-width:0;cursor:pointer;display:flex;align-items:baseline;gap:12px;padding:10px 8px"><strong style="font-size:15px;font-weight:700">${escapeHtml(sheet.name || "이름 없음")}</strong><span style="color:rgba(255,255,255,.6);font-size:13px">${escapeHtml(sheet.player || "플레이어 미설정")}</span></button><button type="button" data-tab-delete="${escapeHtml(sheet.id)}" aria-label="${escapeHtml(sheet.name || "이름 없음")} 삭제" title="삭제" style="${button}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div>`).join("");
    container.innerHTML = `<div id="${TAB_ID}" style="position:absolute;inset:0;overflow:auto;padding:0 24px 24px;font-family:Roboto,'Noto Sans KR',sans-serif;color:#fff"><div style="display:flex;align-items:center;justify-content:space-between;min-height:48px"><span style="color:rgba(255,255,255,.7);font-size:13px">시트를 누르면 시트 창이 열립니다.</span><button type="button" data-tab-add aria-label="시트 추가" title="시트 추가" style="${button}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg></button></div>${rows || '<p style="color:rgba(255,255,255,.6)">시트가 없습니다. ＋로 추가하세요.</p>'}</div>`;
  }

  function openSheetWindow(sheetId) {
    if (!detectRoom()) return false;
    state.open = true;
    state.view = "sheet";
    state.data.selectedId = sheetId;
    ensureRoot();
    render();
    return true;
  }

  function onSheetTabClick(event) {
    const open = event.target.closest("[data-tab-open]");
    if (open) { openSheetWindow(open.dataset.tabOpen); return; }
    const del = event.target.closest("[data-tab-delete]");
    if (del) {
      const sheet = state.data.sheets.find((item) => item.id === del.dataset.tabDelete);
      if (!sheet || !confirm(`'${sheet.name || "이름 없음"}' 시트를 삭제할까요?`)) return;
      state.data.sheets = state.data.sheets.filter((item) => item.id !== sheet.id);
      if (state.data.selectedId === sheet.id) state.data.selectedId = state.data.sheets[0]?.id || "";
      if (state.open) render();
      renderSheetTab(); saveSoon();
      return;
    }
    if (event.target.closest("[data-tab-add]")) {
      const sheet = makeSheet(`시트 ${state.data.sheets.length + 1}`);
      state.data.sheets.push(sheet); renderSheetTab(); saveSoon();
      openSheetWindow(sheet.id);
    }
  }

  function mountSheetTool(container) {
    state.tabContainer = container;
    container.addEventListener("click", onSheetTabClick, { signal });
    renderSheetTab();
  }

  function unmountSheetTool() {
    state.tabContainer = null;
  }

  function openSheet() {
    if (!detectRoom()) return false;
    state.open = true;
    showSheet();
    return true;
  }

  function closeSheet() {
    state.open = false;
    state.collapsed = false;
    state.linkPicker = null;
    state.tablePicker = null;
    state.nativeCharacterDialog = null;
    document.getElementById(ROOT_ID)?.remove();
    renderSheetTab();
  }

  function ensureRoot() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.addEventListener("click", handleClick, { signal });
    root.addEventListener("click", (event) => { if (!event.target.closest(".ccf-cs-menu-host, .ccf-cs-scene-form")) root.querySelectorAll(".ccf-cs-menu").forEach((node) => { node.remove(); root.querySelector('[data-action="scene-menu"]')?.setAttribute("aria-expanded", "false"); }); }, { signal, capture: true });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !root.querySelector(".ccf-cs-menu, .ccf-cs-scene-form")) return;
      event.preventDefault(); event.stopPropagation(); closeSceneUi();
    }, { signal, capture: true });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !(state.linkPicker || state.tablePicker)) return;
      event.preventDefault(); event.stopPropagation(); closeLinkPicker();
    }, { signal, capture: true });
    root.addEventListener("contextmenu", (event) => {
      const skill = event.target.closest?.("button[data-roll]");
      if (!skill) return;
      event.preventDefault();
      inputSkillRoll(skill.dataset.roll, "", false, true);
    }, { signal });
    root.addEventListener("input", handleInput, { signal });
    root.addEventListener("change", handleInput, { signal });
    (state.embedded || document.body).appendChild(root);
    root.classList.toggle("is-embedded", !!state.embedded);
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !state.open) return;
    const scrollTop = root.querySelector(".ccf-cs-dialog>main")?.scrollTop || 0;
    const sheet = currentSheet();
    if (!sheet && state.view === "sheet") state.view = "list";
    const editor = state.view === "sheet";
    root.innerHTML = `
      <section class="ccf-cs-dialog${editor ? " is-editor" : " is-panel"}${state.collapsed ? " is-collapsed" : ""}" role="dialog" aria-modal="false" aria-labelledby="ccf-cs-title">
        <header><h2 id="ccf-cs-title">${editor ? escapeHtml(sheet.name || "이름 없음") : "사이코로픽션"}</h2>${editor ? `<button class="ccf-cs-icon" data-action="back-list" aria-label="캐릭터 시트 목록" title="목록">${backIcon()}</button>${playerLinkField(sheet.player)}` : ""}<button class="ccf-cs-icon" data-action="close" aria-label="닫기" title="닫기">${closeIcon()}</button></header>
        ${editor ? `<main>${renderSections(sheet)}</main>
        <footer>${TABLE_COMMANDS.map(([label, command]) => command === "ST" ? `<span class="ccf-cs-menu-host"><button data-action="scene-menu" aria-haspopup="menu" aria-expanded="false">${d20Icon()}${label}</button></span>` : `<button data-command="${command}">${d20Icon()}${label}</button>`).join("")}<button data-action="fear-roll">${d20Icon()}공포판정</button><button class="ccf-cs-footer-secret" data-action="fear-roll" data-secret="1" aria-label="공포판정(비공개)">${d20Icon()}</button><select class="ccf-cs-table-select" data-command-select aria-label="특기표"><option value="">특기표</option>${SKILL_TABLE_COMMANDS.map(([label, command]) => `<option value="${command}">${label}</option>`).join("")}</select><button data-command="2D6>=? [회피]">${d20Icon()}회피</button><button class="ccf-cs-footer-secret" data-command="2D6>=? [회피]" data-secret="1" aria-label="회피(비공개)">${d20Icon()}</button><select class="ccf-cs-table-select" data-plot-select aria-label="플롯"><option value="">플롯</option><option value="1D6">가변</option>${[1, 2, 3, 4, 5, 6].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></footer>` : `${renderPanelTabs()}<main class="ccf-cs-panel-main">${state.view === "settings" ? renderSettings() : renderSheetList()}</main>`}
      </section>${state.linkPicker ? renderLinkPicker() : state.tablePicker ? renderTablePicker() : ""}`;
    checkD20Font();
    const dialog = root.querySelector(".ccf-cs-dialog");
    dialog.style.transform = `translate3d(${state.dialogPosition.x}px,${state.dialogPosition.y}px,0)`;
    dialog.querySelector("main").scrollTop = scrollTop;
    enableDialogDrag(dialog);
    resizeInlineMemos(dialog);
    renderSheetTab(); // GM 도구 탭의 관리 목록도 같은 데이터(이름·플레이어)로 맞춘다
  }

  function renderPanelTabs() {
    return `<nav class="ccf-cs-tabs" aria-label="사이코로픽션 메뉴"><button data-action="panel-list" aria-selected="${state.view === "list"}">목록</button><button data-action="panel-settings" aria-selected="${state.view === "settings"}">설정</button>${state.view === "list" ? `<button class="ccf-cs-tab-add" data-action="add-sheet" aria-label="캐릭터 시트 추가" title="캐릭터 시트 추가">＋</button>` : ""}</nav>`;
  }

  function renderSheetList() {
    const rows = state.data.sheets.map((sheet) => `<div class="ccf-cs-sheet-item"><button class="ccf-cs-sheet-row" data-action="open-sheet" data-sheet-id="${escapeHtml(sheet.id)}"><strong>${escapeHtml(sheet.name || "이름 없음")}</strong><span>${escapeHtml(sheet.player || "플레이어 미설정")}</span></button><button class="ccf-cs-sheet-delete" data-action="delete-sheet-list" data-sheet-id="${escapeHtml(sheet.id)}" aria-label="${escapeHtml(sheet.name || "이름 없음")} 시트 삭제" title="삭제">${closeIcon()}</button></div>`).join("");
    return `<section class="ccf-cs-panel-section ccf-cs-sheet-panel"><div class="ccf-cs-sheet-list">${rows || '<p class="ccf-cs-empty">시트가 없습니다. ＋로 추가하세요.</p>'}</div></section>`;
  }

  function renderSettings() {
    const rows = permissionRows(state.data.permissions).map(({ key, label, image }) => {
      const value = state.data.permissions?.[key] || {};
      return `<div class="ccf-cs-perm-name">${key === "*" ? "" : renderPlayerAvatar(image)}${escapeHtml(label)}</div>${["view", "secret", "edit"].map((column) => `<label class="ccf-cs-perm-cell"><input type="checkbox" data-perm-key="${escapeHtml(key)}" data-perm-col="${column}"${value[column] ? " checked" : ""}><span></span></label>`).join("")}`;
    }).join("");
    return `<section class="ccf-cs-panel-section ccf-cs-settings"><h3>시트 권한</h3><p>모든 캐릭터 시트에 공통 적용됩니다.<br>전체: 특기·어빌리티·인물 표시<br>개인: 메모 표시<br>수정: 시트 열람 및 수정</p><div class="ccf-cs-perm-grid"><b>이름</b><b>전체</b><b>개인</b><b>수정</b>${rows}</div></section>`;
  }

  function enableDialogDrag(dialog) {
    const handle = dialog?.querySelector("header");
    if (!handle || state.embedded) return;
    // 탑바 더블클릭: 접기/펼치기(핸드아웃 창과 같음). 버튼·입력 위 더블클릭은 무시. 접힘 상태는 창이 열려 있는 동안 유지.
    handle.addEventListener("dblclick", (event) => {
      if (event.target.closest("button,input,select,textarea,a,label")) return;
      state.collapsed = !state.collapsed;
      dialog.classList.toggle("is-collapsed", state.collapsed);
    }, { signal });
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button,input,select,textarea,a")) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, position: { ...state.dialogPosition }, rect: dialog.getBoundingClientRect() };
      const move = (nextEvent) => {
        const delta = clampDialogDrag(start.rect, nextEvent.clientX - start.x, nextEvent.clientY - start.y, innerWidth, innerHeight);
        state.dialogPosition = { x: start.position.x + delta.x, y: start.position.y + delta.y };
        dialog.style.transform = `translate3d(${state.dialogPosition.x}px,${state.dialogPosition.y}px,0)`;
      };
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        document.removeEventListener("pointercancel", stop);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      document.addEventListener("pointercancel", stop);
    }, { signal });
  }

  // ---- 시트 상단: 이미지 | 생명력·이성치·공적점·아이템, 캐릭터 메모, 리스펙 줄 ----
  const RESPECT_TOGGLES = Object.freeze([["newWorld", "새로운 세계"], ["session", "세션 참여"], ["roleplay", "롤플레이"], ["gain", "획득"], ["mission", "사명 달성"]]);
  const RESPECT_NUMBERS = Object.freeze([["empathy", "심금"], ["other", "기타"]]);

  let characterStore = null;
  function findCharacterStore() {
    if (characterStore) return characterStore;
    const root = document.getElementById("root") || document.body?.firstElementChild;
    const key = root ? Object.keys(root).find((name) => name.startsWith("__reactContainer")) : "";
    const fiber = key ? root[key]?.stateNode?.current : null;
    if (!fiber) return null;
    const isStore = (value) => value && typeof value === "object" && typeof value.getState === "function" && typeof value.subscribe === "function";
    const seen = new WeakSet();
    let found = null;
    const visit = (value) => { if (found || !value || typeof value !== "object" || seen.has(value)) return; seen.add(value); if (isStore(value)) found = value; };
    const walk = (node, depth = 0) => {
      if (found || !node || depth > 50) return;
      visit(node.memoizedProps); visit(node.memoizedState); visit(node.stateNode);
      if (node.memoizedProps?.store) visit(node.memoizedProps.store);
      if (node.memoizedProps?.value) visit(node.memoizedProps.value);
      walk(node.child, depth + 1); walk(node.sibling, depth + 1);
    };
    walk(fiber);
    characterStore = found;
    return found;
  }

  // 연결된 코코포리아 캐릭터의 아이콘(iconUrl): 시트에 직접 고른 이미지가 없을 때의 기본값.
  function nativeCharacterIcon(sheet) {
    try {
      const entities = findCharacterStore()?.getState()?.entities?.roomCharacters?.entities || {};
      const names = [sheet.player, sheet.name].map((value) => String(value || "").trim()).filter(Boolean);
      const hit = Object.values(entities).find((character) => character && names.includes(String(character.name || "").trim()) && /^https?:\/\//i.test(character.iconUrl || ""));
      return hit ? hit.iconUrl : "";
    } catch (error) { return ""; }
  }

  function sheetImageUrl(sheet) {
    const own = String(sheet.image || "").trim();
    return /^https?:\/\//i.test(own) ? own : nativeCharacterIcon(sheet);
  }

  function renderPortrait(sheet) {
    const url = sheetImageUrl(sheet);
    return `<button type="button" class="ccf-cs-portrait" data-action="portrait" aria-label="캐릭터 이미지 바꾸기" title="이미지 주소를 입력해 바꿉니다(비우면 캐릭터 아이콘)">${url ? `<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">` : "<span>이미지</span>"}</button>`;
  }

  function renderRespect(sheet) {
    const respec = sheet.respec || {};
    const toggles = RESPECT_TOGGLES.map(([key, label]) => `<label class="ccf-cs-respect-toggle"><span>${label}</span><input type="checkbox" role="switch" data-respec="${key}"${respec[key] ? " checked" : ""}><i aria-hidden="true"></i></label>`).join("");
    const numbers = RESPECT_NUMBERS.map(([key, label]) => `<label class="ccf-cs-respect-number"><span>${label}</span><input type="number" min="0" data-respec="${key}" value="${nonNegativeNumber(respec[key])}"></label>`).join("");
    return `<div class="ccf-cs-respect" role="group" aria-label="리스펙"><strong>리스펙</strong>${toggles}${numbers}<button type="button" class="ccf-cs-respect-roll ccf-cs-roll-public" data-action="respect-roll" aria-label="리스펙 합계를 공적점에 더하고 채팅으로 보내기" title="켜진 항목과 숫자를 더해 채팅으로 보내고 공적점에 더한 뒤 초기화합니다">${d20Icon()}</button></div>`;
  }

  // 리스펙 굴리기: 켜진 항목(각 1점)과 숫자를 더해 내역·합계를 채팅으로 보내고, 공적점에 더한 뒤 토글·숫자를 초기화한다.
  function respectBreakdown(sheet) {
    const respec = sheet.respec || {};
    const parts = [];
    for (const [key, label] of RESPECT_TOGGLES) if (respec[key]) parts.push([label, 1]);
    for (const [key, label] of RESPECT_NUMBERS) { const value = nonNegativeNumber(respec[key]); if (value > 0) parts.push([label, value]); }
    const total = parts.reduce((sum, [, value]) => sum + value, 0);
    return { parts, total, text: `리스펙: ${parts.map(([label, value]) => `${label} ${value}`).join(" + ")} = ${total}` };
  }

  function rollRespect() {
    const sheet = currentSheet();
    if (!sheet) return;
    const { total, text } = respectBreakdown(sheet);
    if (!total) return status("켜진 리스펙 항목이 없습니다");
    sheet.merit = nonNegativeNumber(sheet.merit) + total;
    sheet.respec = { ...(sheet.respec || {}), ...Object.fromEntries(RESPECT_TOGGLES.map(([key]) => [key, false])), ...Object.fromEntries(RESPECT_NUMBERS.map(([key]) => [key, 0])) };
    saveSoon();
    render();
    writeChat(text, true);
  }

  // ---- 하단 '장면표' 메뉴: 장면열기 ▸ 드라마/전투 장면, 장면닫기, 장면표(ST) ----
  // 장면열기/닫기는 채팅 메시지(【드라마 장면 #1-2】 등장인물: … / 배경: …)로 보내고, 인세인 테마에서는 theme-switcher 가 장면표 카드처럼 꺾쇠 카드로 보여 준다.
  const SCENE_KINDS = Object.freeze({ drama: ["드라마 장면", "배경"], battle: ["전투 장면", "대전 상대"] });

  function normalizeScene(value) {
    const cycle = Math.floor(Number(value?.cycle));
    const number = Math.floor(Number(value?.number));
    return { cycle: cycle >= 1 ? cycle : 1, number: number >= 0 ? number : 0 };
  }

  function sceneOpenMessage(kind, cycle, number, cast, detail) {
    const [title, detailLabel] = SCENE_KINDS[kind] || SCENE_KINDS.drama;
    const parts = [];
    if (String(cast || "").trim()) parts.push(`등장인물: ${String(cast).trim()}`);
    if (String(detail || "").trim()) parts.push(`${detailLabel}: ${String(detail).trim()}`);
    return `【${title} #${cycle}-${number}】${parts.length ? ` ${parts.join(" / ")}` : ""}`;
  }

  const SCENE_CLOSE_MESSAGE = "【장면 종료】";

  function closeSceneUi() {
    const root = document.getElementById(ROOT_ID);
    root?.querySelectorAll(".ccf-cs-menu, .ccf-cs-scene-form").forEach((node) => node.remove());
    root?.querySelector('[data-action="scene-menu"]')?.setAttribute("aria-expanded", "false");
  }

  function toggleSceneMenu(button) {
    const host = button.closest(".ccf-cs-menu-host");
    if (!host) return;
    if (host.querySelector(".ccf-cs-menu")) return closeSceneUi();
    closeSceneUi();
    const menu = document.createElement("div");
    menu.className = "ccf-cs-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<button type="button" role="menuitem" data-action="scene-open-submenu" aria-haspopup="menu" aria-expanded="false">장면열기<span aria-hidden="true">▸</span></button>`
      + `<button type="button" role="menuitem" data-action="scene-close">장면닫기</button>`
      + `<button type="button" role="menuitem" data-command="ST">기본 장면표</button>`
      + normalizeSceneTables(state.data.sceneTables).map((table, index) => `<button type="button" role="menuitem" data-action="scene-table" data-index="${index}" title="${escapeHtml(table.macroName)}">${escapeHtml(table.tableName || table.macroName)}</button>`).join("")
      + `<button type="button" role="menuitem" data-action="scene-table-add">장면표 추가…</button>`;
    host.appendChild(menu);
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
  }

  function toggleSceneSubmenu(button) {
    const menu = button.closest(".ccf-cs-menu");
    if (!menu) return;
    const existing = menu.querySelector(".ccf-cs-submenu");
    if (existing) { existing.remove(); button.setAttribute("aria-expanded", "false"); return; }
    const sub = document.createElement("div");
    sub.className = "ccf-cs-submenu";
    sub.setAttribute("role", "menu");
    sub.innerHTML = Object.entries(SCENE_KINDS).map(([kind, [title]]) => `<button type="button" role="menuitem" data-action="scene-form" data-kind="${kind}">${title}</button>`).join("");
    button.after(sub);
    button.setAttribute("aria-expanded", "true");
    sub.querySelector("button")?.focus();
  }

  function openSceneForm(kind) {
    closeSceneUi();
    const dialog = document.querySelector(`#${ROOT_ID} .ccf-cs-dialog`);
    const sheet = currentSheet();
    if (!dialog || !sheet) return;
    const scene = normalizeScene(state.data.scene);
    const [title, detailLabel] = SCENE_KINDS[kind] || SCENE_KINDS.drama;
    const form = document.createElement("form");
    form.className = "ccf-cs-scene-form";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-label", `${title} 열기`);
    form.dataset.kind = kind;
    form.innerHTML = `<h3>${title} 열기</h3>`
      + `<div class="ccf-cs-scene-numbers"><label>사이클<input type="number" min="1" name="cycle" value="${scene.cycle}"></label><label>장면<input type="number" min="0" name="number" value="${scene.number + 1}"></label></div>`
      + `<label>등장인물<input name="cast" value="${escapeHtml(sheet.name || "")}"></label>`
      + `<label>${detailLabel}<input name="detail" value=""></label>`
      + `<div class="ccf-cs-scene-actions"><button type="button" data-action="scene-cancel">취소</button><button type="submit" data-action="scene-send">보내기</button></div>`;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const cycle = Math.max(1, Math.floor(Number(data.get("cycle"))) || 1);
      const number = Math.max(0, Math.floor(Number(data.get("number"))) || 0);
      state.data.scene = { cycle, number };
      saveSoon();
      form.remove();
      writeChat(sceneOpenMessage(kind, cycle, number, data.get("cast"), data.get("detail")), true);
    });
    dialog.appendChild(form);
    form.querySelector('input[name="detail"]')?.focus();
  }

  // ---- 판정: 공개(회색) / 비공개(빨강, 명령 앞 S) 20면체+눈 아이콘, 전체 수정치 ----
  // 판정 아이콘 한 벌: 글꼴 글자(기본) + SVG(글꼴 로드 실패 때만 보임). 공개=흰색, 비공개=rgb(255,0,12)는 버튼 색(currentColor)으로.
  function d20Icon() {
    return `<span class="ccf-cs-d20" aria-hidden="true">t</span>${eyeDiceIcon().replace("<svg ", '<svg class="ccf-cs-d20-fallback" ')}`;
  }

  function checkD20Font() {
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hasAttribute("data-d20-font")) return;
    const set = (ok) => document.getElementById(ROOT_ID)?.setAttribute("data-d20-font", ok ? "1" : "0");
    try {
      const done = (list) => set(!!list?.length && document.fonts.check(`17px ${D20_FONT_FAMILY}`, "t"));
      const loading = document.fonts.load(`17px ${D20_FONT_FAMILY}`, "t");
      loading.then(done, () => set(false));
    } catch (error) { set(false); }
  }

  function eyeDiceIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="M12 2 20.5 7v10L12 22 3.5 17V7z"/><path d="M12 2v3.4M20.5 7l-3.2 2.1M20.5 17l-3.2-2.1M12 22v-3.4M3.5 17l3.2-2.1M3.5 7l3.2 2.1" opacity=".55"/><path d="M7.6 12c1.2-1.9 2.9-2.9 4.4-2.9s3.2 1 4.4 2.9c-1.2 1.9-2.9 2.9-4.4 2.9S8.8 13.9 7.6 12z"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>';
  }

  function clampModifier(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.max(-9, Math.min(9, number)) : 0;
  }

  // 주사위 식 뒤에 붙는 보정: 공포(-2)와 전체 수정치를 합친 값("+1", "-1", 0이면 빈 글자)
  function rollModifierText(sheet, fear = false) {
    const total = (fear ? -2 : 0) + clampModifier(sheet?.modifier);
    return total > 0 ? `+${total}` : total < 0 ? String(total) : "";
  }

  function rollCommandPrefix(secret) { return secret ? "S" : ""; }

  // 2D6 으로 시작하는 고정 명령(회피 등)에도 전체 수정치와 비공개 접두를 적용한다.
  function applyRollOptions(command, secret) {
    const text = String(command || "");
    if (!/^S?2D6/i.test(text)) return text;
    const body = text.replace(/^S/i, "");
    return rollCommandPrefix(secret) + body.replace(/^2D6/i, `2D6${rollModifierText(currentSheet())}`);
  }

  function updateModifierNote() {
    const note = document.querySelector(`#${ROOT_ID} .ccf-cs-modifier-note`);
    if (!note) return;
    const modifier = clampModifier(currentSheet()?.modifier);
    note.textContent = modifier ? `수정치 ${modifier > 0 ? "+" : ""}${modifier}` : "";
    note.hidden = !modifier;
  }

  // ---- 내 캐릭터 목록 모달: 각 행의 '토큰을 화면에서 삭제' 버튼 왼쪽에 사이코로픽션 버튼 ----
  const TOKEN_DELETE_LABELS = ["토큰을 화면에서 삭제", "Remove token from screen", "コマを画面から削除"];

  function openSheetForCharacterName(name) {
    const clean = String(name || "").trim();
    state.nativeCharacterDialog = null;
    const linked = findLinkedSheet(state.data.sheets, clean);
    if (linked) { selectSheet(linked.id); return openSheet(); }
    const sheet = makeSheet(clean || `시트 ${state.data.sheets.length + 1}`);
    sheet.player = clean;
    state.data.sheets.push(sheet);
    state.open = true;
    showSheet();
    selectSheet(sheet.id);
    saveSoon();
    return true;
  }

  function rowCharacterName(row, ownButton) {
    const primary = row.querySelector('.MuiListItemText-primary, h6, [class*="primary"]');
    if (primary?.textContent?.trim()) return primary.textContent.trim();
    const clone = row.cloneNode(true);
    clone.querySelectorAll("button, svg").forEach((node) => node.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  // 실제 "내 캐릭터 목록"은 Dialog 가 아니라 떠 있는 창(Paper: 제목 줄 AppBar(Paper) + .scrollable-list)이고, 행의 토큰 버튼은 활성이면 "삭제", 아니면 "추가"(번역 라벨)다.
  // 그래서 제목으로 창을 찾아(제목에서 가장 가까운 Paper 는 제목 줄이므로 목록을 품은 바깥 Paper 까지) 행을 이름 글자로 찾고, 보조 동작 칸의 버튼 왼쪽(없으면 행 끝)에 시트 버튼을 단다.
  const LIST_WINDOW_TITLES = ["내캐릭터목록", "mycharacters", "マイキャラクター一覧", "マイキャラクター", "キャラクター一覧", "캐릭터목록"];
  function listWindows() {
    const windows = new Set();
    document.querySelectorAll("h6, h5, h4, h3, h2").forEach((heading) => {
      if (heading.closest(`#${ROOT_ID}`) || !LIST_WINDOW_TITLES.includes(String(heading.textContent || "").replace(/\s+/g, "").toLowerCase())) return;
      let found = null;
      for (let node = heading.parentElement; node; node = node.parentElement) {
        if (node.matches?.(".MuiPaper-root, [role='dialog']")) { found = node; if (node.querySelector(".scrollable-list, .MuiListItemText-primary")) break; }
        if (node === document.body) break;
      }
      if (found instanceof HTMLElement && found.getClientRects().length) windows.add(found);
    });
    return [...windows];
  }
  function mountWindowRowButtons() {
    for (const panel of listWindows()) {
      panel.querySelectorAll(".MuiListItemText-primary").forEach((name) => {
        if (name.closest("[data-ccf-others-row]")) return; // 다른 사람 캐릭터 행은 others-characters 가 자기 시트 버튼을 단다
        const row = name.closest(".MuiListItem-container") || name.closest(".MuiListItem-root, li"); // 보조 동작 칸은 컨테이너 쪽에 있다
        if (!row || row.querySelector(`[${ROW_BUTTON_ATTR}]`)) return;
        const secondary = row.querySelector(".MuiListItemSecondaryAction-root");
        const anchor = secondary?.querySelector("button");
        const button = document.createElement("button");
        button.type = "button";
        button.className = anchor?.className || "MuiButtonBase-root MuiIconButton-root";
        button.setAttribute(ROW_BUTTON_ATTR, "1");
        button.setAttribute("aria-label", "사이코로픽션 시트");
        button.title = "사이코로픽션 시트";
        button.innerHTML = diceIcon();
        const stop = (event) => { event.stopPropagation(); };
        button.addEventListener("click", (event) => { event.stopPropagation(); event.preventDefault(); openSheetForCharacterName(rowCharacterName(row, button)); }, { signal });
        for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart"]) button.addEventListener(type, stop, { signal });
        if (anchor) anchor.parentElement.insertBefore(button, anchor); else (secondary || row).appendChild(button);
      });
    }
  }

  function mountCharacterListButtons() {
    mountWindowRowButtons();
    document.querySelectorAll('.MuiDialog-root, [role="dialog"]').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.closest(`#${ROOT_ID}`)) return;
      dialog.querySelectorAll("button[aria-label], button[title]").forEach((remove) => {
        const label = `${remove.getAttribute("aria-label") || ""} ${remove.getAttribute("title") || ""}`;
        if (!TOKEN_DELETE_LABELS.some((text) => label.includes(text))) return;
        const previous = remove.previousElementSibling;
        if (previous?.hasAttribute(ROW_BUTTON_ATTR)) return;
        const row = remove.closest('li, .MuiListItem-root, [role="listitem"], [role="row"]') || remove.parentElement?.parentElement;
        if (!row) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = remove.className;
        button.setAttribute(ROW_BUTTON_ATTR, "1");
        button.setAttribute("aria-label", "사이코로픽션 시트");
        button.title = "사이코로픽션 시트";
        button.innerHTML = diceIcon();
        const stop = (event) => { event.stopPropagation(); };
        button.addEventListener("click", (event) => { event.stopPropagation(); event.preventDefault(); openSheetForCharacterName(rowCharacterName(row, button)); }, { signal });
        for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart"]) button.addEventListener(type, stop, { signal });
        remove.parentElement.insertBefore(button, remove);
      });
    });
  }

  function renderSections(sheet) {
    const skillOptions = CATEGORIES.flatMap((category, column) => category.slice(1).map((name, row) => `<option value="${column}:${row}"${sheet.fear === `${column}:${row}` ? " selected" : ""}>${category[0]} · ${name}</option>`)).join("");
    const basic = `<div class="ccf-cs-basic">
      <div class="ccf-cs-top">${renderPortrait(sheet)}<div class="ccf-cs-stats-items"><div class="ccf-cs-stats">
        ${vitalField("생명력", "life", sheet.life, "lifeMax", sheet.lifeMax)}
        ${vitalField("이성치", "sanity", sheet.sanity, "sanityMax", sheet.sanityMax)}
        ${numberField("merit", "공적점", sheet.merit)}
        ${textField("etc", "ETC", sheet.etc)}
      </div>${renderItemFields(sheet.items)}</div></div>
      <label class="ccf-cs-profile-memo"><span>캐릭터 메모</span><textarea data-field="memo" placeholder="나이 / 성별 / 직업">${escapeHtml(profileMemo(sheet))}</textarea></label>
      ${renderRespect(sheet)}
    </div>`;
    const skillSettings = `<div class="ccf-cs-skill-options">
      <label>호기심 분야<select data-field="curiosity"><option value="">선택 안 함</option>${CATEGORIES.map((category, index) => `<option value="${index}"${String(index) === String(sheet.curiosity) ? " selected" : ""}>${category[0]}</option>`).join("")}</select></label>
      <label>공포심<select data-field="fear"><option value="">선택 안 함</option>${skillOptions}</select></label>
      <label>전체 수정치<input type="number" min="-9" max="9" step="1" data-field="modifier" value="${clampModifier(sheet.modifier)}"></label>
    </div>`;
    return section("", basic, "ccf-cs-basic-section")
      + section("", renderSkills(sheet) + skillSettings, "ccf-cs-section-wide")
      + `<div class="ccf-cs-duo">${section("어빌리티 리스트", renderRepeaters("abilities", sheet.abilities, [["name", "어빌리티"], ["type", "타입"], ["target", "지정특기"]]), "", "abilities")}${section("관계 목록", renderRepeaters("people", sheet.people, [["name", "이름"], ["emotion", "감정"], ["shelter", "거처"]]), "", "people")}</div>`;
  }

  function section(title, content, className = "", addKey = "") {
    const heading = title || addKey ? `<div class="ccf-cs-section-head">${title ? `<h3>${title}</h3>` : ""}${addKey ? `<button class="ccf-cs-section-add" data-add="${addKey}" aria-label="${title} 추가" title="${title} 추가">＋</button>` : ""}</div>` : "";
    return `<section class="ccf-cs-form-section ${className}">${heading}${content}</section>`;
  }

  function profileMemo(sheet) {
    if (sheet.memo) return sheet.memo;
    return [["나이", sheet.age], ["성별", sheet.gender], ["직업", sheet.occupation]]
      .filter(([, value]) => String(value || "").trim())
      .map(([label, value]) => `${label}: ${value}`)
      .join("\n");
  }

  function permissionRows(permissions = {}) {
    const rows = [{ key: "*", label: "전원" }];
    const handout = window.__CCF_HANDOUT_DEBUG__;
    const players = handout?.getPlayers?.() || [];
    const peers = window.__CAPYBARA_TOOLKIT_PRESENCE__?.getPeers?.() || [];
    for (const peer of peers) {
      const name = cleanText(peer?.name, 100).trim();
      if (name && !rows.some((row) => row.key === name)) rows.push({ key: name, label: peer.self ? `${name} (나)` : name });
    }
    for (const key of Object.keys(permissions)) {
      if (key !== "*" && !rows.some((row) => row.key === key)) rows.push({ key, label: key });
    }
    for (const player of players) {
      if (player.name && !rows.some((row) => row.key === player.name)) rows.push({ key: player.name, label: player.name });
    }
    for (const row of rows) {
      if (row.key !== "*") row.image = handout?.getPlayerImage?.(row.key) || "";
    }
    return rows;
  }

  function renderPlayerAvatar(image) {
    return `<span class="ccf-cs-player-avatar" aria-hidden="true">${/^https?:\/\//i.test(image || "") ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}</span>`;
  }

  function closeIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  }

  function linkIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function rollIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M12 2 21 8l-3 11H6L3 8z"/><path d="m12 2-4 7 4 8 4-8zM3 8l5 1m8 0 5-1M6 19l6-2 6 2M8 9l-2 10m10-10 2 10"/></svg>';
  }

  function backIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.42-1.41L7.83 13H20v-2z"/></svg>';
  }

  function diceIcon() {
    return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 8 3 8-3-8-3z"/><path d="m4 10 1 8 7 3 7-3 1-8M12 13v8"/><path d="M4 10 2 7l7-3 3 3M12 7l3-3 7 2-2 4"/><circle cx="7.8" cy="14.6" r=".8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="13.8" r=".8" fill="currentColor" stroke="none"/><circle cx="15.4" cy="17.1" r=".8" fill="currentColor" stroke="none"/></svg>';
  }

  function renderSkills(sheet) {
    const modifier = clampModifier(sheet.modifier);
    return `<p class="ccf-cs-modifier-note"${modifier ? "" : " hidden"}>${modifier ? `수정치 ${modifier > 0 ? "+" : ""}${modifier}` : ""}</p><div class="ccf-cs-skills">${CATEGORIES.map((category, column) => `<section><h3>${category[0]}</h3>${category.slice(1).map((name, row) => {
      const id = `${column}:${row}`;
      const target = getSkillTarget(sheet.skills, id, sheet.removedGaps);
      return `<div class="ccf-cs-skill${sheet.fear === id ? " is-fear" : ""}${sheet.skills.includes(id) ? " is-selected" : ""}"><input type="checkbox" data-skill="${id}" aria-label="${name} 습득"${sheet.skills.includes(id) ? " checked" : ""}><button data-roll="${id}" title="${name} 판정 입력 (Shift+클릭·우클릭: 비공개)">${name}<small>${target || "–"}</small></button></div>`;
    }).join("")}</section>${column < CATEGORIES.length - 1 ? `<i class="ccf-cs-gap${sheet.removedGaps[column] ? " is-active" : ""}" aria-hidden="true"></i>` : ""}`).join("")}</div>`;
  }

  function renderRepeaters(key, items, fields) {
    const heading = `<div class="ccf-cs-repeater-head" aria-hidden="true"><div class="ccf-cs-repeater-fields">${fields.map(([, label]) => `<span>${label}</span>`).join("")}</div></div>`;
    return `<div class="ccf-cs-repeaters ccf-cs-${key}">${heading}${items.map((item, index) => {
      const noteKey = `${currentSheet().id}:${key}:${item.id || index}`;
      const noteOpen = state.openNotes.has(noteKey);
      const itemName = item.name || `${index + 1}번 항목`;
      const memo = item.memo || (key === "abilities" ? item.effect : "") || (key === "people" ? item.detail : "");
      return `<section>${key === "abilities" ? `<span class="ccf-cs-roll-pair"><button class="ccf-cs-ability-roll ccf-cs-roll-public" data-ability-roll="${index}" aria-label="${escapeHtml(itemName)} 판정" title="판정">${d20Icon()}</button></span>` : ""}<button class="ccf-cs-note-toggle${noteOpen || memo ? " is-active" : ""}" data-note="${key}" data-item-id="${escapeHtml(item.id || index)}" data-index="${index}" aria-label="${escapeHtml(itemName)} 메모 ${noteOpen ? "닫기" : "열기"}" aria-expanded="${noteOpen}"></button><div class="ccf-cs-repeater-fields">${fields.map(([fieldName, label]) => fieldName === "shelter" ? `<label class="ccf-cs-respect-toggle ccf-cs-shelter" title="거처(居所)를 앎"><span class="ccf-cs-shelter-label">${label}</span><input type="checkbox" role="switch" data-list="${key}" data-index="${index}" data-prop="shelter" aria-label="${escapeHtml(itemName)} ${label}"${item.shelter ? " checked" : ""}><i aria-hidden="true"></i></label>` : fieldName === "detail" ? `<textarea data-list="${key}" data-index="${index}" data-prop="${fieldName}" aria-label="${escapeHtml(itemName)} ${label}">${escapeHtml(item[fieldName] || "")}</textarea>` : `<input data-list="${key}" data-index="${index}" data-prop="${fieldName}" aria-label="${escapeHtml(itemName)} ${label}" value="${escapeHtml(item[fieldName] || "")}">`).join("")}</div><button class="ccf-cs-remove" data-remove="${key}" data-index="${index}" aria-label="삭제" title="삭제">×</button>${noteOpen ? `<textarea class="ccf-cs-inline-memo" data-list="${key}" data-index="${index}" data-prop="memo" placeholder="메모" aria-label="${escapeHtml(itemName)} 메모">${escapeHtml(memo)}</textarea>` : ""}</section>`;
    }).join("")}</div>`;
  }

  function resizeInlineMemos(scope) {
    scope?.querySelectorAll?.(".ccf-cs-inline-memo").forEach((textarea) => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }

  // ---- 캐릭터 연결 모달: 내 캐릭터 목록과 같은 모양(아이콘·이름 행). 연결값(player)은 캐릭터 이름 ----
  async function readAuthUids() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open("firebaseLocalStorageDb"); } catch (error) { resolve([]); return; }
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        try {
          const all = req.result.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
          all.onsuccess = () => resolve((all.result || []).map((record) => record?.value?.uid).filter(Boolean).map(String));
          all.onerror = () => resolve([]);
        } catch (error) { resolve([]); }
      };
    });
  }

  // 저장소의 roomCharacters 중 내 계정(owner = 로그인 uid)의 캐릭터. uid 를 못 읽으면 구분할 수 없으므로 전체를 보인다.
  async function readMyCharacters() {
    let characters = [];
    try { characters = Object.values(findCharacterStore()?.getState()?.entities?.roomCharacters?.entities || {}).filter((character) => character && String(character.name || "").trim()); } catch (error) { /* 저장소 없음 */ }
    const uids = await readAuthUids();
    const mine = uids.length ? characters.filter((character) => uids.includes(String(character.owner))) : characters;
    return mine.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name), "ko")).map((character) => ({ name: String(character.name).trim(), icon: /^https?:\/\//i.test(character.iconUrl || "") ? character.iconUrl : "" }));
  }

  async function openLinkPicker() {
    const list = await readMyCharacters();
    if (!state.open || !currentSheet()) return;
    state.linkPicker = { list };
    render();
    document.querySelector(`#${ROOT_ID} .ccf-cs-link-picker`)?.focus();
  }

  function closeLinkPicker() {
    if (!state.linkPicker && !state.tablePicker) return;
    state.linkPicker = null;
    state.tablePicker = null;
    render();
  }

  function chooseLinkedCharacter(name) {
    const sheet = currentSheet();
    state.linkPicker = null;
    if (sheet) { sheet.player = name; saveSoon(); }
    render();
  }

  // ---- 장면표 추가: 커스텀 커맨드(ccf-slash-macros-v1) 중 /roll-table 본문 후보를 체크로 고른다 ----
  function readRollTableMacros() {
    try {
      const list = JSON.parse(localStorage.getItem("ccf-slash-macros-v1") || "[]");
      return (Array.isArray(list) ? list : []).filter((item) => item && typeof item.name === "string" && /^\/roll-table\b/.test(String(item.body || "").trim()))
        .map((item) => ({ macroName: item.name, tableName: String(item.body).trim().split(/\r?\n/)[1]?.trim() || item.name, body: String(item.body) }));
    } catch (error) { return []; }
  }

  function openTablePicker() {
    const saved = normalizeSceneTables(state.data.sceneTables);
    const candidates = readRollTableMacros();
    const extra = saved.filter((table) => !candidates.some((item) => item.macroName === table.macroName)).map((table) => ({ ...table, orphan: true }));
    state.tablePicker = { candidates: [...candidates, ...extra] };
    render();
    document.querySelector(`#${ROOT_ID} .ccf-cs-link-picker`)?.focus();
  }

  function renderTablePicker() {
    const saved = new Set(normalizeSceneTables(state.data.sceneTables).map((table) => table.macroName));
    const rows = (state.tablePicker?.candidates || []).map((item, index) => `<li><label class="ccf-cs-link-row"><input type="checkbox" data-table-toggle="${index}"${saved.has(item.macroName) ? " checked" : ""}><span class="ccf-cs-link-name">${escapeHtml(item.tableName || item.macroName)}<small>커스텀 커맨드: ${escapeHtml(item.macroName)}${item.orphan ? " (이 브라우저에 없음)" : ""}</small></span></label></li>`).join("");
    return `<div class="ccf-cs-link-picker" role="dialog" aria-modal="true" aria-label="장면표 추가" tabindex="-1"><div class="ccf-cs-link-card"><header><h3>장면표 추가</h3><button type="button" class="ccf-cs-icon" data-action="link-close" aria-label="닫기" title="닫기">${closeIcon()}</button></header><ul>${rows}</ul>${rows ? "" : '<p class="ccf-cs-empty">등록된 /roll-table 커스텀 커맨드가 없습니다.</p>'}</div></div>`;
  }

  function toggleSceneTable(index, checked) {
    const item = state.tablePicker?.candidates?.[index];
    if (!item) return;
    const list = normalizeSceneTables(state.data.sceneTables).filter((table) => table.macroName !== item.macroName);
    if (checked) list.push({ macroName: item.macroName, tableName: item.tableName, body: item.body });
    state.data.sceneTables = normalizeSceneTables(list);
    saveSoon();
  }

  function renderLinkPicker() {
    const sheet = currentSheet();
    const current = String(sheet?.player || "").trim();
    const list = [...(state.linkPicker?.list || [])];
    if (current && !list.some((item) => item.name === current)) list.unshift({ name: current, icon: "" });
    const row = (name, label, icon) => `<li><button type="button" class="ccf-cs-link-row${name === current ? " is-selected" : ""}" data-action="link-choose" data-name="${escapeHtml(name)}"><span class="ccf-cs-link-avatar" aria-hidden="true">${icon ? `<img src="${escapeHtml(icon)}" alt="" referrerpolicy="no-referrer">` : ""}</span><span class="ccf-cs-link-name">${escapeHtml(label)}</span></button></li>`;
    return `<div class="ccf-cs-link-picker" role="dialog" aria-modal="true" aria-label="캐릭터 연결" tabindex="-1"><div class="ccf-cs-link-card"><header><h3>캐릭터 연결</h3><button type="button" class="ccf-cs-icon" data-action="link-close" aria-label="닫기" title="닫기">${closeIcon()}</button></header><ul>${row("", "선택 안 함", "")}${list.map((item) => row(item.name, item.name, item.icon)).join("")}</ul>${list.length ? "" : '<p class="ccf-cs-empty">내 캐릭터가 없습니다.</p>'}</div></div>`;
  }

  function playerLinkField(value) {
    return `<button type="button" class="ccf-cs-icon ccf-cs-player-link" data-action="link-pick" aria-label="캐릭터 연결" title="${value ? `연결: ${escapeHtml(value)}` : "캐릭터 연결"}">${linkIcon()}</button>`;
  }

  function numberField(name, label, value) {
    return `<label>${label}<input type="number" min="0" data-field="${name}" value="${Number(value) || 0}"></label>`;
  }

  function textField(name, label, value) {
    return `<label>${label}<input data-field="${name}" value="${escapeHtml(value || "")}"></label>`;
  }

  function vitalField(label, valueName, value, maxName, max) {
    return `<label class="ccf-cs-vital"><span>${label}</span><span><input type="number" min="0" data-field="${valueName}" value="${Number(value) || 0}" aria-label="현재 ${label}"><input type="number" min="0" data-field="${maxName}" value="${Number(max) || 0}" aria-label="최대 ${label}"></span></label>`;
  }

  function renderItemFields(items) {
    const entries = Object.entries(normalizeItems(items));
    return `<div class="ccf-cs-item-fields">${entries.map(([label, value]) => `<label>${escapeHtml(label)}<input type="number" min="0" data-item="${escapeHtml(label)}" value="${value}"></label>`).join("")}</div>`;
  }

  function handleInput(event) {
    const target = event.target;
    const sheet = currentSheet();
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (!sheet && !target.dataset.permKey) return;
    if (target.dataset.tableToggle !== undefined) { toggleSceneTable(Number(target.dataset.tableToggle), target.checked); return; }
    if (target.dataset.commandSelect !== undefined) {
      const command = target.value;
      target.value = "";
      if (command) sendCommand(command);
      return;
    }
    if (target.dataset.plotSelect !== undefined) {
      const value = target.value;
      target.value = "";
      if (value) writeChat(`sc(${value})`);
      return;
    }
    if (target.dataset.respec) {
      sheet.respec ||= {};
      sheet.respec[target.dataset.respec] = target.type === "checkbox" ? target.checked : nonNegativeNumber(target.value);
      saveSoon();
      return;
    }
    if (target.dataset.item) {
      sheet.items ||= {};
      sheet.items[target.dataset.item] = nonNegativeNumber(target.value);
      saveSoon();
      return;
    }
    if (target.dataset.field === "modifier") {
      sheet.modifier = clampModifier(target.value);
      updateModifierNote();
      saveSoon();
      return;
    }
    if (target.dataset.field) {
      const key = target.dataset.field;
      sheet[key] = target.type === "number" ? Number(target.value) : target.value;
      if (key === "curiosity") {
        sheet.removedGaps = getCuriosityGaps(target.value);
        updateSkillsView();
      } else if (key === "name") {
        const title = document.querySelector(`#${ROOT_ID} #ccf-cs-title`);
        if (title) title.textContent = target.value || "이름 없음";
      }
      syncNativeCharacterField(key, sheet[key]);
      saveSoon();
      return;
    }
    if (target.dataset.skill) {
      sheet.skills = target.checked ? [...new Set([...sheet.skills, target.dataset.skill])] : sheet.skills.filter((id) => id !== target.dataset.skill);
      target.closest(".ccf-cs-skill")?.classList.toggle("is-selected", target.checked);
      updateSkillsView();
      saveSoon();
      return;
    }
    if (target.dataset.list) {
      const item = sheet[target.dataset.list]?.[Number(target.dataset.index)];
      if (item) item[target.dataset.prop] = target.type === "checkbox" ? target.checked : target.value;
      if (target.classList.contains("ccf-cs-inline-memo")) resizeInlineMemos(target.parentElement);
      saveSoon();
      return;
    }
    if (target.dataset.permKey && target.dataset.permCol) {
      const key = target.dataset.permKey;
      state.data.permissions ||= {};
      state.data.permissions[key] ||= { view: false, secret: false, edit: false };
      state.data.permissions[key][target.dataset.permCol] = target.checked;
      state.data.permissions = normalizePermissions(state.data.permissions);
      saveSoon();
    }
  }

  function handleClick(event) {
    if (event.target.classList?.contains("ccf-cs-link-picker")) return closeLinkPicker();
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.action === "close") return closeSheet();
    if (button.dataset.action === "link-pick") return openLinkPicker();
    if (button.dataset.action === "link-close") return closeLinkPicker();
    if (button.dataset.action === "link-choose") return chooseLinkedCharacter(button.dataset.name || "");
    if (button.dataset.action === "panel-list" || button.dataset.action === "back-list") { state.view = "list"; return render(); }
    if (button.dataset.action === "panel-settings") { state.view = "settings"; return render(); }
    if (!currentSheet() && !["open-sheet", "delete-sheet-list", "add-sheet"].includes(button.dataset.action)) return;
    if (button.dataset.action === "scene-menu") return toggleSceneMenu(button);
    if (button.dataset.action === "scene-open-submenu") return toggleSceneSubmenu(button);
    if (button.dataset.action === "scene-form") return openSceneForm(button.dataset.kind);
    if (button.dataset.action === "scene-cancel") return closeSceneUi();
    if (button.dataset.action === "scene-table") { closeSceneUi(); const table = normalizeSceneTables(state.data.sceneTables)[Number(button.dataset.index)]; return table ? writeChat(table.body) : undefined; }
    if (button.dataset.action === "scene-table-add") { closeSceneUi(); return openTablePicker(); }
    if (button.dataset.action === "scene-close") { closeSceneUi(); return writeChat(SCENE_CLOSE_MESSAGE, true); }
    if (button.dataset.action === "respect-roll") return rollRespect();
    if (button.dataset.action === "portrait") {
      const sheet = currentSheet();
      const next = window.prompt("캐릭터 이미지 주소(https://…). 비우면 코코포리아 캐릭터 아이콘을 씁니다.", sheet.image || "");
      if (next === null) return;
      const value = String(next).trim();
      if (value && !/^https?:\/\//i.test(value)) return status("https:// 로 시작하는 주소를 입력하세요");
      sheet.image = value;
      saveSoon(); render(); return;
    }
    if (button.dataset.action === "open-sheet") return selectSheet(button.dataset.sheetId);
    if (button.dataset.action === "delete-sheet-list") {
      const sheet = state.data.sheets.find((item) => item.id === button.dataset.sheetId);
      if (!sheet || !confirm(`'${sheet.name || "이름 없음"}' 시트를 삭제할까요?`)) return;
      state.data.sheets = state.data.sheets.filter((item) => item.id !== sheet.id);
      if (state.data.selectedId === sheet.id) state.data.selectedId = state.data.sheets[0]?.id || "";
      render(); saveSoon(); return;
    }
    if (button.dataset.action === "add-sheet") {
      const sheet = makeSheet(`시트 ${state.data.sheets.length + 1}`);
      state.data.sheets.push(sheet); selectSheet(sheet.id); saveSoon(); return;
    }
    if (button.dataset.add) {
      currentSheet()[button.dataset.add].push({ id: makeId() }); render(); saveSoon(); return;
    }
    if (button.dataset.note) {
      const noteKey = `${currentSheet().id}:${button.dataset.note}:${button.dataset.itemId || button.dataset.index}`;
      state.openNotes.has(noteKey) ? state.openNotes.delete(noteKey) : state.openNotes.add(noteKey);
      render(); return;
    }
    if (button.dataset.remove) {
      currentSheet()[button.dataset.remove].splice(Number(button.dataset.index), 1); state.openNotes.clear(); render(); saveSoon(); return;
    }
    if (button.dataset.abilityRoll !== undefined) {
      const ability = currentSheet().abilities[Number(button.dataset.abilityRoll)];
      const skill = findSkillId(ability?.target);
      return skill ? inputSkillRoll(skill, ability?.name, true, button.dataset.secret === "1") : status("지정특기를 먼저 선택");
    }
    if (button.dataset.action === "fear-roll") {
      const fear = currentSheet().fear;
      return fear ? inputSkillRoll(fear, "", false, button.dataset.secret === "1") : status("공포심을 먼저 선택");
    }
    if (button.dataset.command) { if (button.closest(".ccf-cs-menu")) closeSceneUi(); return sendCommand(applyRollOptions(button.dataset.command, button.dataset.secret === "1")); }
    if (button.dataset.roll) return inputSkillRoll(button.dataset.roll, "", false, event.shiftKey);
  }

  function updateSkillsView() {
    const root = document.getElementById(ROOT_ID);
    const sheet = currentSheet();
    if (!sheet) return;
    root?.querySelectorAll(".ccf-cs-gap").forEach((gap, index) => gap.classList.toggle("is-active", !!sheet.removedGaps[index]));
    root?.querySelectorAll("button[data-roll]").forEach((button) => {
      button.parentElement?.classList.toggle("is-fear", sheet.fear === button.dataset.roll);
      const target = getSkillTarget(sheet.skills, button.dataset.roll, sheet.removedGaps);
      const value = button.querySelector("small");
      if (value) value.textContent = target || "–";
    });
  }

  function inputSkillRoll(id, subject = "", submit = false, secret = false) {
    const sheet = currentSheet();
    if (!sheet) return;
    const target = getSkillTarget(sheet.skills, id, sheet.removedGaps);
    if (!target) return status("습득 특기를 먼저 선택");
    const [column, row] = id.split(":").map(Number);
    const name = CATEGORIES[column][row + 1];
    const fear = sheet.fear === id;
    writeChat(`${rollCommandPrefix(secret)}2D6${rollModifierText(sheet, fear)}>=${target} [${subject ? `${subject}/` : ""}${name}${fear ? "/공포심" : ""}]`);
  }

  function looksLikeTransfer(text) {
    return typeof text === "string" && text.includes(`"${TRANSFER_KIND}"`);
  }

  function handleTransferPaste(event) {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!looksLikeTransfer(text) || !detectRoom()) return;
    event.preventDefault();
    event.stopPropagation();
    importTransferText(text);
  }

  async function readTransferFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      importTransferText(text);
    } catch (error) {
      status("클립보드를 읽지 못함: Ctrl+V 사용");
    }
  }

  function importTransferText(text) {
    try {
      const sheet = parseTransferPayload(text);
      if (!Object.keys(state.data.permissions || {}).length) state.data.permissions = normalizePermissions(sheet.permissions);
      delete sheet.permissions;
      state.data.sheets.push(sheet);
      state.data.selectedId = sheet.id;
      state.open = true;
      state.view = "sheet";
      showSheet();
      syncNativeItems(sheet);
      status("시트 가져옴");
      saveSoon();
      if (!sheet.player) openLinkPicker();
      return sheet;
    } catch (error) {
      if (state.open) status(error.message || "시트를 가져오지 못함");
      console.warn("[ccf-character-sheet] import failed", error);
      return null;
    }
  }

  // 목표치가 정해지지 않은 명령(2D6>=? [회피] 처럼 ? 가 남은 것)은 작은 입력으로 숫자를 받아 채운 뒤 보낸다. 취소하면 보내지 않는다.
  function sendCommand(command) {
    let text = String(command || "");
    if (/>=\?/.test(text)) {
      const answer = window.prompt("목표치(숫자)", "");
      const value = String(answer ?? "").trim();
      if (answer === null) return;
      if (!/^\d{1,3}$/.test(value)) return status("목표치는 숫자로 입력하세요");
      text = text.replace(/>=\?/, `>=${value}`);
    }
    return writeChat(text);
  }

  // 커맨드를 입력칸에 넣고 보내는 동안 입력칸 글을 투명하게(높이 고정·캐럿 숨김) 해서 본문이 비치지 않게 한다. 비워지면 원복, 전송이 안 되면 원복 + 안내.
  // 보내는 동안 입력창: 글자·커서를 투명하게 하고, 입력칸(textarea)과 그 래퍼(MUI InputBase)의 높이를 원래 값으로 고정한다.
  // MUI 의 자동 높이(TextareaAutosize)는 글이 바뀔 때마다 textarea 의 인라인 height 를 다시 쓰므로 인라인 값으로는 못 막는다 → 속성 + !important 스타일 규칙(인라인보다 앞선다)과 CSS 변수로 고정한다.
  function hideEditorWhileSending(editor) {
    if (!(editor instanceof HTMLTextAreaElement)) return () => {};
    // 연속으로 보낼 때 두 번째가 '이미 고정된 상태'를 원래 값으로 저장하지 않도록, 처음 한 번만 걸고 마지막 복원 때 푼다.
    let hold = editor.__ccfSheetHide;
    if (!hold) {
      const wrap = editor.closest(".MuiInputBase-root") || editor.parentElement;
      hold = editor.__ccfSheetHide = { count: 0, wrap, hadWrapAttr: wrap?.hasAttribute("data-ccf-sheet-sending-wrap") };
      editor.style.setProperty("--ccf-sheet-h", `${editor.offsetHeight}px`);
      editor.setAttribute("data-ccf-sheet-sending", "1");
      if (wrap && wrap !== editor) { wrap.style.setProperty("--ccf-sheet-wh", `${wrap.offsetHeight}px`); wrap.setAttribute("data-ccf-sheet-sending-wrap", "1"); }
    }
    hold.count += 1;
    let restored = false;
    return (failed = false) => {
      if (restored) return; restored = true;
      hold.count -= 1;
      if (hold.count <= 0) {
        editor.removeAttribute("data-ccf-sheet-sending");
        editor.style.removeProperty("--ccf-sheet-h");
        if (!editor.getAttribute("style")) editor.removeAttribute("style");
        if (hold.wrap) { hold.wrap.removeAttribute("data-ccf-sheet-sending-wrap"); hold.wrap.style.removeProperty("--ccf-sheet-wh"); if (!hold.wrap.getAttribute("style")) hold.wrap.removeAttribute("style"); }
        delete editor.__ccfSheetHide;
      }
      if (failed) status("전송되지 않았습니다");
    };
  }
  function writeChat(command, submit = true) {
    const editors = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')];
    const editor = editors.find((node) => !node.closest(`#${ROOT_ID}, [role="dialog"], .MuiDialog-root`) && isVisible(node) && findSubmitScope(node));
    if (!editor) return status("채팅 입력창을 찾지 못함");
    // 글을 넣기 전에 먼저 고정한다: 넣는 순간 MUI 자동 높이가 입력칸을 키우므로, 그 뒤에 재면 이미 커진 높이가 "원래" 값이 된다.
    const restore = submit ? hideEditorWhileSending(editor) : null;
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(editor.constructor.prototype, "value")?.set;
      if (setter) setter.call(editor, command); else editor.value = command;
    } else editor.textContent = command;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    // 시트는 닫기 버튼·Esc 로만 닫힌다. 보낸 뒤 채팅 입력칸에 포커스를 가져가지 않는다.
    if (submit) {
      const submitButton = findSubmitScope(editor)?.querySelector('button[type="submit"]');
      submitButton?.click();
      // 보내면 코코포리아가 입력칸을 비운다 → 원복. 끝까지 안 비워지면(전송 실패) 원복하고 안내.
      const started = Date.now();
      const watch = () => {
        const left = editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent;
        if (!left || left !== command) return restore();
        if (Date.now() - started > 1500) return restore(true);
        setTimeout(watch, 60);
      };
      setTimeout(watch, 60);
    }
  }

  function findSubmitScope(editor) {
    let node = editor.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (node.querySelector('button[type="submit"]')) return node;
    }
    return null;
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function status(message) {
    const node = document.getElementById("ccf-cs-status");
    if (node) node.textContent = message;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @font-face { font-family:"${D20_FONT_FAMILY}";src:url(data:font/woff;base64,${D20_FONT_BASE64}) format("woff");font-display:block }
      [${ICON_ATTR}] { all:unset;box-sizing:border-box;width:40px;height:40px;margin:0 2px;color:inherit;display:inline-grid;place-items:center;border-radius:50%;cursor:pointer;vertical-align:middle;transition:background-color 150ms cubic-bezier(.4,0,.2,1) }
      [${ICON_ATTR}]:hover { background:rgba(255,255,255,.1) }
      [${DIALOG_BUTTON_ATTR}] { position:static!important;display:inline-grid!important;place-items:center;width:36px!important;min-width:36px!important;height:36px!important;margin:0 4px!important;padding:6px!important;flex:0 0 36px;transition:background-color 150ms cubic-bezier(.4,0,.2,1) }
      [${DIALOG_BUTTON_ATTR}] svg { width:24px;height:24px;pointer-events:none }
      #${ROOT_ID},#${ROOT_ID} * { box-sizing:border-box;font-family:"Roboto","Noto Sans KR","Noto Sans JP",system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0 }
      #${ROOT_ID} { position:fixed;inset:0;z-index:2147483000;color:#eee;font-size:14px;pointer-events:none }
      #${ROOT_ID} .ccf-cs-dialog { position:absolute;inset:10px;margin:auto;width:min(500px,calc(100vw - 20px));height:min(600px,calc(100vh - 20px));pointer-events:auto;display:grid;background:rgba(44,44,44,.87);background-image:none;border:0;border-radius:4px;box-shadow:0px 11px 15px -7px rgba(0,0,0,.2),0px 24px 38px 3px rgba(0,0,0,.14),0px 9px 46px 8px rgba(0,0,0,.12);overflow:hidden }
      #${ROOT_ID} .ccf-cs-dialog.is-editor { grid-template-rows:64px minmax(0,1fr) auto }
      /* 폭은 내용에 맞춘다: 가장 넓은 줄은 리스펙 줄(한 줄 유지에 약 850px 필요, 특기 표는 734px): 본문 좌우 여백 40 + 스크롤바 여유 포함해 860(14.7: 예전 900에서 줄임) */
      #${ROOT_ID} .ccf-cs-dialog.is-editor { width:min(860px,calc(100vw - 64px));height:min(900px,calc(100vh - 64px)) }
      #${ROOT_ID} .ccf-cs-dialog.is-panel { grid-template-rows:64px 48px minmax(0,1fr) }
      #${ROOT_ID}.is-embedded { position:absolute;inset:0;pointer-events:auto }
      #${ROOT_ID}.is-embedded .ccf-cs-dialog { position:absolute;inset:0;margin:0;width:100%!important;height:100%!important;box-shadow:none;border-radius:0;background:transparent;transform:none!important }
      #${ROOT_ID}.is-embedded .ccf-cs-dialog>header { cursor:default }
      .ccf-gt-body:not([data-single-tab]) #${ROOT_ID}.is-embedded .ccf-cs-dialog.is-panel>header { display:none }
      .ccf-gt-body:not([data-single-tab]) #${ROOT_ID}.is-embedded .ccf-cs-dialog.is-panel { grid-template-rows:48px minmax(0,1fr) } /* 목록: 제목 "사이코로픽션"은 탭 이름과 같고 버튼도 없다 */
      #${ROOT_ID}.is-embedded .ccf-cs-dialog>header [data-action="close"] { display:none }
      #${ROOT_ID} .ccf-cs-dialog.is-collapsed { height:auto!important;min-height:0;bottom:auto!important;top:calc(50% - 32px)!important;margin:0 auto;grid-template-rows:64px }
      #${ROOT_ID} .ccf-cs-dialog.is-collapsed>:not(header) { display:none!important }
      #${ROOT_ID} header,#${ROOT_ID} footer { display:flex;align-items:center;gap:8px;padding:8px 16px;border:0 }
      #${ROOT_ID} .ccf-cs-dialog>header { background:#212121!important;color:#fff }
      #${ROOT_ID} .ccf-cs-dialog>footer { background:#212121 }
      #${ROOT_ID} header { cursor:move;touch-action:none;user-select:none }
      #${ROOT_ID} .ccf-cs-dialog>header { padding:0 16px 0 24px }
      #${ROOT_ID} header h2 { margin:0;font-size:1.25rem;font-weight:bold;line-height:1.6;letter-spacing:.0075em;flex:1 }
      #${ROOT_ID} .ccf-cs-dialog.is-editor>header h2 { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      #${ROOT_ID} button,#${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea { font:inherit;color:inherit }
      #${ROOT_ID} button { min-height:36px;padding:0 12px;background:transparent;border:1px solid rgba(255,255,255,.23);border-radius:4px;cursor:pointer;transition:background-color 150ms cubic-bezier(.4,0,.2,1),color 150ms cubic-bezier(.4,0,.2,1),border-color 150ms cubic-bezier(.4,0,.2,1) }
      #${ROOT_ID} button:hover { background:rgba(255,255,255,.08) }
      #${ROOT_ID} button:active { background:rgba(255,255,255,.16) }
      #${ROOT_ID} .ccf-cs-icon { width:40px;min-width:40px;padding:0;border:0;background:transparent;display:grid;place-items:center }
      #${ROOT_ID} .ccf-cs-icon svg { width:24px;height:24px;fill:currentColor;pointer-events:none }
      #${ROOT_ID} .ccf-cs-player-link { position:relative;display:grid;color:#fff;cursor:pointer }
      #${ROOT_ID} .ccf-cs-empty { margin:16px;color:#bdbdbd;text-align:center }
      #${ROOT_ID} .ccf-cs-link-picker { position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:rgba(0,0,0,.5);pointer-events:auto;outline:0 }
      #${ROOT_ID} .ccf-cs-link-card { width:min(420px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 64px));display:flex;flex-direction:column;background:#212121;box-shadow:0 12px 32px rgba(0,0,0,.6);overflow:hidden }
      #${ROOT_ID} .ccf-cs-link-card header { display:flex;align-items:center;justify-content:space-between;min-height:56px;padding:0 8px 0 24px }
      #${ROOT_ID} .ccf-cs-link-card h3 { margin:0;font-size:20px;font-weight:500 }
      #${ROOT_ID} .ccf-cs-link-card ul { margin:0;padding:0;list-style:none;overflow:auto }
      #${ROOT_ID} .ccf-cs-link-row { all:unset;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:16px;min-height:56px;padding:8px 24px;color:#fff;cursor:pointer }
      #${ROOT_ID} .ccf-cs-link-row:hover,#${ROOT_ID} .ccf-cs-link-row:focus-visible { background:rgba(255,255,255,.08) }
      #${ROOT_ID} .ccf-cs-link-row.is-selected { background:rgba(245,0,87,.18) }
      #${ROOT_ID} .ccf-cs-link-avatar { display:inline-flex;flex:0 0 40px;width:40px;height:40px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.12) }
      #${ROOT_ID} .ccf-cs-link-avatar img { width:100%;height:100%;object-fit:cover }
      #${ROOT_ID} .ccf-cs-link-name { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      #${ROOT_ID} .ccf-cs-link-name small { display:block;color:#bdbdbd;font-size:12px }
      #${ROOT_ID} label.ccf-cs-link-row input { flex:0 0 18px;width:18px!important;height:18px;min-height:0!important;margin:0 }
      #${ROOT_ID} .ccf-cs-player-link svg { width:18px;height:18px }
      #${ROOT_ID} main { min-height:0;overflow:auto;padding:0 20px 24px;scrollbar-color:#777 #212121 }
      #${ROOT_ID} .ccf-cs-tabs { display:flex;height:48px;padding:0 16px;background:#212121;border:0 }
      #${ROOT_ID} .ccf-cs-tabs button { min-width:96px;height:48px;border:0;border-bottom:2px solid transparent;border-radius:0;color:#9e9e9e;font-weight:bold }
      #${ROOT_ID} .ccf-cs-tabs button[aria-selected="true"] { color:#fff;border-bottom-color:#f50057 }
      #${ROOT_ID} .ccf-cs-tabs .ccf-cs-tab-add { margin-left:auto;min-width:48px;padding:0;color:#fff;font-size:22px;font-weight:normal }
      #${ROOT_ID} .ccf-cs-panel-main { padding:20px }
      #${ROOT_ID} .ccf-cs-panel-section { max-width:680px;margin:0 auto }
      #${ROOT_ID} .ccf-cs-panel-heading { display:flex;align-items:center;margin-bottom:8px }
      #${ROOT_ID} .ccf-cs-panel-heading h3,#${ROOT_ID} .ccf-cs-settings h3 { margin:0;font-size:14px;font-weight:bold }
      #${ROOT_ID} .ccf-cs-panel-heading button { margin-left:auto;width:36px;padding:0;border:0;border-radius:0;font-size:20px }
      #${ROOT_ID} .ccf-cs-sheet-panel .ccf-cs-panel-heading { height:36px;margin-top:-12px;margin-bottom:4px }
      #${ROOT_ID} .ccf-cs-sheet-list { display:grid }
      #${ROOT_ID} .ccf-cs-sheet-item { display:grid;grid-template-columns:minmax(0,1fr) 40px;align-items:center }
      #${ROOT_ID} .ccf-cs-sheet-row { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;width:100%;padding:14px 8px;border:0;border-radius:0;text-align:left }
      #${ROOT_ID} .ccf-cs-sheet-delete { width:40px;min-width:40px;padding:0;border:0;border-radius:0;display:grid;place-items:center }
      #${ROOT_ID} .ccf-cs-sheet-delete svg { width:20px;height:20px;fill:currentColor;pointer-events:none }
      #${ROOT_ID} .ccf-cs-sheet-row strong { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      #${ROOT_ID} .ccf-cs-sheet-row span { overflow:hidden;color:#bdbdbd;text-overflow:ellipsis;white-space:nowrap }
      #${ROOT_ID} .ccf-cs-settings { display:grid;gap:18px }
      #${ROOT_ID} .ccf-cs-perm-name { display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere }
      #${ROOT_ID} .ccf-cs-player-avatar { display:inline-flex;width:24px;height:24px;flex:0 0 24px;border-radius:0;overflow:hidden;background:rgba(255,255,255,.08) }
      #${ROOT_ID} .ccf-cs-player-avatar img { display:block;width:100%;height:100%;object-fit:cover;border-radius:0 }
      #${ROOT_ID} .ccf-cs-settings>p { margin:0;color:#bdbdbd;line-height:1.65 }
      #${ROOT_ID} .ccf-cs-settings>button { justify-self:start;border:0;border-radius:0;color:#f50057;font-weight:bold }
      #${ROOT_ID} .ccf-cs-form-section { padding:22px 0 24px }
      #${ROOT_ID} .ccf-cs-section-head { display:flex;align-items:center;gap:8px;margin:0 0 16px }
      #${ROOT_ID} .ccf-cs-section-head h3 { margin:0;color:#fff;font-size:14px;font-weight:bold }
      #${ROOT_ID} .ccf-cs-section-add,#${ROOT_ID} .ccf-cs-remove { min-height:32px;padding:0;border:0;border-radius:0;background:transparent }
      #${ROOT_ID} .ccf-cs-section-add { width:32px;font-size:20px }
      #${ROOT_ID} .ccf-cs-section-wide { overflow-x:auto }
      #${ROOT_ID} label { display:grid;gap:5px;color:#bdbdbd;font-size:13px;transition:color 200ms cubic-bezier(.4,0,.2,1) }
      #${ROOT_ID} .ccf-cs-dialog main label:focus-within { color:#2196f3 }
      #${ROOT_ID} input:not([type="checkbox"]),#${ROOT_ID} select,#${ROOT_ID} textarea { width:100%;min-height:36px;padding:4px 2px 2px;color:#fff;font-size:16px;background-color:transparent;background-image:linear-gradient(#2196f3,#2196f3);background-repeat:no-repeat;background-position:center bottom;background-size:0 2px;border:0;border-bottom:1px solid rgba(255,255,255,.55);border-radius:0;outline:0;transition:border-color 200ms cubic-bezier(.4,0,.2,1),border-width 150ms cubic-bezier(.4,0,.2,1),background-size 200ms cubic-bezier(.4,0,.2,1) }
      #${ROOT_ID} select { padding-right:32px }
      #${ROOT_ID} select option { color:#000 }
      #${ROOT_ID} input:not([type="checkbox"]):hover,#${ROOT_ID} select:hover,#${ROOT_ID} textarea:hover { border-bottom-color:rgba(255,255,255,.87);border-bottom-width:2px }
      #${ROOT_ID} input:not([type="checkbox"]):focus,#${ROOT_ID} select:focus,#${ROOT_ID} textarea:focus { border-bottom-color:transparent;border-bottom-width:2px;background-size:100% 2px }
      #${ROOT_ID} textarea { min-height:100px;resize:vertical }
      #${ROOT_ID} .ccf-cs-basic { display:grid;grid-template-columns:minmax(0,1fr);gap:16px }
      #${ROOT_ID} .ccf-cs-menu-host { position:relative;display:inline-flex }
      #${ROOT_ID} .ccf-cs-menu,#${ROOT_ID} .ccf-cs-submenu { z-index:5;min-width:152px;padding:8px 0;background:#424242;color:#fff;border-radius:4px;box-shadow:0 5px 5px -3px rgba(0,0,0,.2),0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12) }
      #${ROOT_ID} .ccf-cs-menu { position:absolute;left:0;bottom:calc(100% + 4px) }
      #${ROOT_ID} .ccf-cs-submenu { position:absolute;left:calc(100% - 4px);top:0 }
      #${ROOT_ID} .ccf-cs-menu button,#${ROOT_ID} .ccf-cs-dialog>footer .ccf-cs-menu button { display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:36px;padding:6px 16px;border:0;border-radius:0;background:transparent;color:#fff;font-size:14px;text-align:left;cursor:pointer }
      #${ROOT_ID} .ccf-cs-menu button:hover,#${ROOT_ID} .ccf-cs-menu button:focus-visible { background:rgba(255,255,255,.1);outline:none }
      #${ROOT_ID} .ccf-cs-scene-form { position:absolute;z-index:6;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;gap:12px;width:min(360px,calc(100% - 32px));padding:20px;background:#303030;border:1px solid rgba(255,255,255,.16);box-shadow:0 11px 15px -7px rgba(0,0,0,.4),0 24px 38px 3px rgba(0,0,0,.28) }
      #${ROOT_ID} .ccf-cs-scene-form h3 { margin:0;font-size:16px }
      #${ROOT_ID} .ccf-cs-scene-numbers { display:grid;grid-template-columns:1fr 1fr;gap:12px }
      #${ROOT_ID} .ccf-cs-scene-actions { display:flex;justify-content:flex-end;gap:8px }
      #${ROOT_ID} .ccf-cs-scene-actions button { min-width:72px;min-height:36px;border:0;border-radius:0;background:transparent;color:#fff;cursor:pointer }
      #${ROOT_ID} .ccf-cs-scene-actions button[type="submit"] { color:#f50057;font-weight:bold }
      [${ROW_BUTTON_ATTR}] { display:inline-grid;place-items:center;color:inherit }
      [${ROW_BUTTON_ATTR}] svg { width:24px;height:24px;pointer-events:none }
      #${ROOT_ID} .ccf-cs-roll-pair { display:flex;align-items:center;gap:0 }
      #${ROOT_ID} .ccf-cs-roll-pair .ccf-cs-ability-roll { width:32px;min-width:32px }
      #${ROOT_ID} .ccf-cs-roll-public,#${ROOT_ID} .ccf-cs-footer-public { color:#fff }
      #${ROOT_ID} .ccf-cs-roll-secret,#${ROOT_ID} .ccf-cs-footer-secret { color:rgb(255,0,12) }
      textarea[data-ccf-sheet-sending] { color:transparent!important;caret-color:transparent!important;height:var(--ccf-sheet-h)!important;min-height:var(--ccf-sheet-h)!important;max-height:var(--ccf-sheet-h)!important;overflow:hidden!important;resize:none!important }
      [data-ccf-sheet-sending-wrap] { height:var(--ccf-sheet-wh)!important;min-height:var(--ccf-sheet-wh)!important;max-height:var(--ccf-sheet-wh)!important;box-sizing:border-box!important }
      #${ROOT_ID} .ccf-cs-dialog button.ccf-cs-roll-public,#${ROOT_ID} .ccf-cs-dialog button.ccf-cs-respect-roll { color:#fff }
      #${ROOT_ID} .ccf-cs-dialog button.ccf-cs-footer-secret,#${ROOT_ID} .ccf-cs-dialog button.ccf-cs-roll-secret { color:rgb(255,0,12) }
      #${ROOT_ID} .ccf-cs-roll-public:hover,#${ROOT_ID} .ccf-cs-respect-roll:hover { background:rgba(255,255,255,.14) }
      #${ROOT_ID} .ccf-cs-d20 { font-family:"${D20_FONT_FAMILY}",sans-serif;font-size:17px;line-height:1;font-weight:normal;font-style:normal;pointer-events:none;display:none }
      #${ROOT_ID} .ccf-cs-d20-fallback { display:none }
      #${ROOT_ID} footer button:not(.ccf-cs-footer-secret) { display:inline-flex;align-items:center;gap:4px }
      #${ROOT_ID} footer button:not(.ccf-cs-footer-secret) .ccf-cs-d20-fallback { width:17px;height:17px }
      #${ROOT_ID}[data-d20-font="1"] .ccf-cs-d20 { display:inline-block }
      #${ROOT_ID}[data-d20-font="0"] .ccf-cs-d20-fallback { display:inline-block }
      #${ROOT_ID} .ccf-cs-dialog>footer .ccf-cs-footer-secret { width:30px;min-width:30px;padding:0;display:inline-grid;place-items:center;background:transparent }
      #${ROOT_ID} .ccf-cs-footer-secret svg { width:20px;height:20px;pointer-events:none }
      #${ROOT_ID} .ccf-cs-form-section .ccf-cs-skill-options { grid-template-columns:repeat(3,minmax(0,1fr)) }
      #${ROOT_ID} .ccf-cs-modifier-note { margin:0 0 6px;color:#bdbdbd;font-size:12px }
      #${ROOT_ID} .ccf-cs-skill button[data-roll] { display:grid;grid-template-columns:1fr auto;column-gap:40px;padding-right:0;text-align:left }
      #${ROOT_ID} main { container-type:inline-size }
      #${ROOT_ID} .ccf-cs-duo { display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:0 24px;align-items:start }
      #${ROOT_ID} .ccf-cs-duo>.ccf-cs-form-section { min-width:0 }
      @container (max-width:640px) { #${ROOT_ID} .ccf-cs-duo { grid-template-columns:minmax(0,1fr) } }
      #${ROOT_ID} .ccf-cs-top { display:grid;grid-template-columns:auto minmax(0,1fr);gap:24px;align-items:stretch }
      #${ROOT_ID} .ccf-cs-top>.ccf-cs-stats-items { grid-column:auto }
      #${ROOT_ID} .ccf-cs-portrait { align-self:stretch;height:100%;width:auto;aspect-ratio:1;min-height:120px;padding:0;border:1px solid rgba(255,255,255,.24);border-radius:0;background:#1b1b1b;color:#9e9e9e;overflow:hidden;cursor:pointer }
      #${ROOT_ID} .ccf-cs-portrait img { display:block;width:100%;height:100%;object-fit:cover }
      #${ROOT_ID} .ccf-cs-portrait:hover { border-color:rgba(255,255,255,.6) }
      #${ROOT_ID} .ccf-cs-respect { display:flex;align-items:center;flex-wrap:wrap;gap:8px 8px;min-height:44px;padding:0 8px 0 0;background:#1b1b1b }
      #${ROOT_ID} .ccf-cs-respect strong { align-self:stretch;display:grid;place-items:center;padding:0 12px;margin-right:0;background:#000;color:#fff;font-size:14px }
      #${ROOT_ID} .ccf-cs-respect label { display:inline-flex;align-items:center;gap:4px;color:#e0e0e0;font-size:13px }
      #${ROOT_ID} .ccf-cs-respect-toggle input { position:absolute;opacity:0;width:1px!important;min-height:0!important;height:1px;pointer-events:none }
      #${ROOT_ID} .ccf-cs-respect-toggle i { position:relative;flex:0 0 38px;width:38px;height:20px;border-radius:10px;background:#616161;transition:background-color 120ms }
      #${ROOT_ID} .ccf-cs-respect-toggle i::after { content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.5);transition:transform 120ms }
      #${ROOT_ID} .ccf-cs-respect-toggle input:checked+i { background:#2196f3 }
      #${ROOT_ID} .ccf-cs-dialog main .ccf-cs-respect-toggle:focus-within,#${ROOT_ID} .ccf-cs-dialog main .ccf-cs-respect-number:focus-within,#${ROOT_ID} .ccf-cs-dialog main .ccf-cs-respect label:focus-within { color:#e0e0e0 }
      #${ROOT_ID} .ccf-cs-respect-toggle input:checked+i::after { transform:translateX(18px) }
      #${ROOT_ID} .ccf-cs-respect-toggle input:focus-visible+i { outline:2px solid #2196f3;outline-offset:2px }
      #${ROOT_ID} .ccf-cs-respect-number input { width:36px!important;min-height:24px!important;height:24px;padding:0 4px!important;border:0!important;border-radius:3px;background:rgba(255,255,255,.1)!important;background-image:none!important;text-align:center;font-size:15px;-moz-appearance:textfield;appearance:textfield }
      #${ROOT_ID} .ccf-cs-respect-number input::-webkit-inner-spin-button,#${ROOT_ID} .ccf-cs-respect-number input::-webkit-outer-spin-button { -webkit-appearance:none;margin:0 }
      #${ROOT_ID} .ccf-cs-respect-number input:focus { background:rgba(255,255,255,.16)!important;box-shadow:inset 0 -2px 0 #f50057;outline:0 }
      #${ROOT_ID} .ccf-cs-respect-roll { margin-left:auto;flex:0 0 36px;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:transparent;color:#e0e0e0;display:grid;place-items:center;cursor:pointer }
      #${ROOT_ID} .ccf-cs-respect-roll:hover { background:rgba(255,255,255,.12) }
      #${ROOT_ID} .ccf-cs-respect-roll svg { width:24px;height:24px }
      #${ROOT_ID} .ccf-cs-basic-section { padding-top:22px }
      #${ROOT_ID} .ccf-cs-profile-memo { grid-column:1/-1;display:block;padding:12px 16px 0;background:rgba(255,255,255,.1);color:#bdbdbd }
      #${ROOT_ID} .ccf-cs-profile-memo span { display:block;margin-bottom:2px }
      #${ROOT_ID} .ccf-cs-profile-memo textarea { width:calc(100% + 32px);min-height:140px;margin:0 -16px;padding:0 16px;background-color:transparent;resize:none }
      #${ROOT_ID} .ccf-cs-stats-items { grid-column:1/-1;display:grid;grid-template-columns:minmax(220px,.8fr) minmax(0,1.2fr);gap:24px;align-items:start }
      #${ROOT_ID} .ccf-cs-stats,#${ROOT_ID} .ccf-cs-item-fields { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px }
      #${ROOT_ID} .ccf-cs-vital { grid-column:1/-1 }
      #${ROOT_ID} .ccf-cs-vital>span:last-child { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px }
      #${ROOT_ID} .ccf-cs-field-pair,#${ROOT_ID} .ccf-cs-skill-options { grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px }
      #${ROOT_ID} .ccf-cs-skill-options { margin-top:18px }
      #${ROOT_ID} .ccf-cs-skill input { appearance:none;width:13px;min-width:13px;height:13px;min-height:13px;margin:2px;background:#363636;border:0;border-radius:4px;cursor:pointer;transition:background-color 200ms ease }
      #${ROOT_ID} .ccf-cs-skill input:checked { background:#f50057 }
      #${ROOT_ID} .ccf-cs-skills { display:grid;grid-template-columns:repeat(5,max-content 8px) max-content;width:max-content;max-width:none }
      #${ROOT_ID} .ccf-cs-section-wide { overflow-x:auto }
      #${ROOT_ID} .ccf-cs-skills section { background:transparent;border:0 }
      #${ROOT_ID} .ccf-cs-gap { display:block;width:6px;justify-self:center;background:#363636;border-radius:0;transition:background-color 200ms ease }
      #${ROOT_ID} .ccf-cs-gap.is-active { background:#f50057 }
      #${ROOT_ID} .ccf-cs-skills h3 { margin:0;padding:4px;text-align:center;font-size:13px;font-weight:600;background:transparent;border-bottom:2px solid #363636 }
      #${ROOT_ID} .ccf-cs-skill { display:flex;align-items:center;gap:4px;padding:4px 6px;border:0 }
      #${ROOT_ID} .ccf-cs-skill.is-selected { background:rgba(255,255,255,.14) }
      #${ROOT_ID} .ccf-cs-skill.is-selected button { font-weight:bold }
      #${ROOT_ID} .ccf-cs-skill.is-fear button { color:#f50057;font-weight:bold }
      #${ROOT_ID} .ccf-cs-skill button { flex:1;display:flex;justify-content:space-between;align-items:center;min-height:22px;border:0;background:transparent;padding:0;font-size:.9em }
      #${ROOT_ID} .ccf-cs-skill small { color:#fff;font-size:11px }
      #${ROOT_ID} .ccf-cs-repeaters { display:grid;gap:12px }
      #${ROOT_ID} .ccf-cs-repeater-head { display:grid;grid-template-columns:32px minmax(0,1fr) 32px;gap:10px;color:#bdbdbd;font-size:13px }
      #${ROOT_ID} .ccf-cs-repeater-head .ccf-cs-repeater-fields { grid-column:2 }
      #${ROOT_ID} .ccf-cs-repeaters section { display:grid;grid-template-columns:32px minmax(0,1fr) 32px;gap:10px;align-items:start;padding-bottom:12px;border:0 }
      #${ROOT_ID} .ccf-cs-abilities { gap:4px }
      #${ROOT_ID} .ccf-cs-abilities .ccf-cs-repeater-head { grid-template-columns:32px 32px minmax(0,1fr) 32px }
      #${ROOT_ID} .ccf-cs-abilities .ccf-cs-repeater-head .ccf-cs-repeater-fields { grid-column:3 }
      #${ROOT_ID} .ccf-cs-abilities section { grid-template-columns:32px 32px minmax(0,1fr) 32px;padding-bottom:4px }
      #${ROOT_ID} .ccf-cs-abilities .ccf-cs-inline-memo { grid-column:3/4 }
      #${ROOT_ID} .ccf-cs-ability-roll { width:32px;min-width:32px;height:32px;min-height:32px;padding:0;border:0;border-radius:0;display:grid;place-items:center }
      #${ROOT_ID} .ccf-cs-ability-roll svg { width:20px;height:20px;fill:none;stroke:currentColor;pointer-events:none }
      #${ROOT_ID} .ccf-cs-note-toggle { align-self:center;justify-self:center;width:13px;min-width:13px;height:13px;min-height:13px;padding:0;background:rgba(255,255,255,.7);border:0;border-radius:0;cursor:pointer }
      #${ROOT_ID} .ccf-cs-note-toggle:hover { background:#fff }
      #${ROOT_ID} .ccf-cs-note-toggle.is-active { background:#f50057 }
      #${ROOT_ID} .ccf-cs-people .ccf-cs-repeater-fields,#${ROOT_ID} .ccf-cs-people .ccf-cs-repeater-head .ccf-cs-repeater-fields { grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 72px;align-items:center }
      #${ROOT_ID} .ccf-cs-shelter { display:inline-flex;align-items:center;gap:6px;color:#e0e0e0;font-size:13px }
      #${ROOT_ID} .ccf-cs-people .ccf-cs-repeater-head .ccf-cs-repeater-fields span:last-child { padding-left:0 }
      #${ROOT_ID} .ccf-cs-remove { width:32px;font-size:20px;color:#bdbdbd }
      #${ROOT_ID} .ccf-cs-repeater-fields { display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px }
      #${ROOT_ID} .ccf-cs-repeater-fields input,#${ROOT_ID} .ccf-cs-repeater-fields textarea { height:36px;min-height:36px;resize:none }
      #${ROOT_ID} .ccf-cs-inline-memo { grid-column:2/3;min-height:40px;height:auto;overflow:hidden;resize:none;field-sizing:content }
      #${ROOT_ID} footer { flex-wrap:wrap }
      #${ROOT_ID} footer .ccf-cs-save { margin-left:auto;color:#f50057;font-weight:bold }
      #${ROOT_ID} .ccf-cs-dialog>footer button { border:0;border-radius:0 }
      #${ROOT_ID} .ccf-cs-dialog>footer .ccf-cs-table-select { width:auto;min-height:36px;padding:0 28px 0 12px;background-color:transparent;background-image:none;border:0;border-radius:0;font-size:14px }
      #${ROOT_ID} .ccf-cs-perm-grid { display:grid;grid-template-columns:minmax(0,1fr) repeat(3,64px);align-items:center;padding:8px 16px;overflow:auto }
      #${ROOT_ID} .ccf-cs-perm-grid>b { padding:8px 4px;color:#fff;text-align:center }
      #${ROOT_ID} .ccf-cs-perm-grid>b:first-child { text-align:left }
      #${ROOT_ID} .ccf-cs-perm-name { padding:12px 4px;border-top:1px solid rgba(255,255,255,.12);color:#fff }
      #${ROOT_ID} .ccf-cs-perm-cell { display:grid;place-items:center;align-self:stretch;border-top:1px solid rgba(255,255,255,.12) }
      #${ROOT_ID} .ccf-cs-perm-cell input { width:18px;min-height:18px;accent-color:#f50057 }
      #${ROOT_ID} .ccf-cs-perm-cell span { display:none }
      @media (max-width:700px) {
        #${ROOT_ID} .ccf-cs-repeaters section { grid-template-columns:32px minmax(0,1fr) 32px }
        #${ROOT_ID} .ccf-cs-abilities section { grid-template-columns:32px 32px minmax(0,1fr) 32px }
        #${ROOT_ID} .ccf-cs-repeater-fields { grid-template-columns:1fr }
        #${ROOT_ID} main { padding:0 12px 16px }
        #${ROOT_ID} #ccf-cs-status { display:none }
        #${ROOT_ID} .ccf-cs-perm-grid { grid-template-columns:minmax(0,1fr) repeat(3,52px);padding:8px }
      }
    `;
    document.documentElement.appendChild(style);
  }
})();
