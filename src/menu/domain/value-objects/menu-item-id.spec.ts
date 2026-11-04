import { InvalidMenuItemIdError, MenuItemId } from '..';

describe('MenuItemId', () => {
  it('gera um UUID v7', () => {
    const id = MenuItemId.generate();

    expect(id.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gera ids únicos e em ordem crescente', () => {
    const ids = Array.from({ length: 1000 }, () => MenuItemId.generate().value);

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('aceita um UUID válido e normaliza para minúsculas', () => {
    const id = MenuItemId.from('0192F3A4-1B2C-7D3E-8F40-123456789ABC');

    expect(id.value).toBe('0192f3a4-1b2c-7d3e-8f40-123456789abc');
  });

  it.each([undefined, null, 1, '', 'abc', '1', '0192f3a4-1b2c-7d3e-8f40'])(
    'rejeita o valor inválido %p',
    (value) => {
      expect(() => MenuItemId.from(value)).toThrow(InvalidMenuItemIdError);
    },
  );

  it('compara por valor', () => {
    const raw = MenuItemId.generate().value;

    expect(MenuItemId.from(raw).equals(MenuItemId.from(raw))).toBe(true);
    expect(MenuItemId.from(raw).equals(MenuItemId.generate())).toBe(false);
  });
});
