import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const returnUrl = 'https://peptidemy.com';

  return (
    <s-stack gap="base">
      <s-button href={returnUrl} variant="primary">
        Return back to shopping
      </s-button>
    </s-stack>
  );
}
