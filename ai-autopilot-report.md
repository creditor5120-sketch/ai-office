# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office avatar selection and detail view toggle logic to ensure the COO (알렉스) is correctly selected and displayed upon initialization and detail view toggling.

## 판단 근거

The current implementation of `detailToggle.onclick` and the `load` event listener had a slight inconsistency in ensuring the COO (알렉스) is the default selected avatar when the detail view is toggled or the page loads. By centralizing the selection logic and ensuring the `selectAvatar` function is called with the correct parameters, we ensure the UI state remains consistent with the routing contract.

