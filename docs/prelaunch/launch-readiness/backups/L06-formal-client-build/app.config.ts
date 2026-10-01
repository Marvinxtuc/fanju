export default defineAppConfig({
  // Explicitly enable WeChat's privacy authorization flow for capabilities such as getPhoneNumber.
  // The platform still requires the matching data type to be declared in its privacy guide.
  __usePrivacyCheck__: true,
  pages: [
    "pages/home/index",
    "pages/activity-detail/index",
    "pages/mock-auth/index",
    "pages/profile/index",
    "pages/order-detail/index",
    "pages/order-list/index",
    "pages/money-records/index",
    "pages/inbox/index",
    "pages/prelaunch/index"
  ],
  window: {
    navigationBarTitleText: "餐厅兴趣体验",
    navigationBarBackgroundColor: "#f7f3ec",
    navigationBarTextStyle: "black",
    backgroundTextStyle: "dark"
  }
});
