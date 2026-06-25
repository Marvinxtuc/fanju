export default defineAppConfig({
  pages: [
    "pages/home/index",
    "pages/activity-detail/index",
    "pages/mock-auth/index",
    "pages/order-detail/index"
  ],
  window: {
    navigationBarTitleText: "餐厅兴趣体验",
    navigationBarBackgroundColor: "#f7f3ec",
    navigationBarTextStyle: "black",
    backgroundTextStyle: "dark"
  }
});

function defineAppConfig<TConfig extends Record<string, unknown>>(config: TConfig): TConfig {
  return config;
}
